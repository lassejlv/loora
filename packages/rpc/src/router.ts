import { and, asc, desc, eq, isNotNull, lt, or } from 'drizzle-orm'
import { ORPCError, os } from '@orpc/server'
import { z } from 'zod'
import { db } from '@loora/db'
import {
  asset,
  design,
  designChat,
  designGithubRepository,
  designVersion,
  oauthAccessToken,
  oauthApplication,
  oauthConsent,
  user,
  userPreferences,
} from '@loora/db/schema'
import { EMPTY_SHORTCUT_CONFIG } from '@loora/db/shortcuts'
import { parseShortcutConfig, shortcutConfigSchema } from './shortcuts'
import { agentSystemPromptSchema } from './agent-prompt'
import { googleOAuthEnabled, type getSession } from '@loora/auth'
import type { CanvasElement } from '@loora/db/canvas'
import { assetKey, s3 } from './storage'
import { createHandoffToken } from './handoff-token'
import {
  authorizeBilling,
  createPlanCheckout,
  getBillingStatus,
  refreshBillingStatus,
} from '@loora/auth/billing'
import { canUseApp, isPreviewAccessRequired } from '@loora/auth/preview-access'
import { completeTopUpCheckout, createTopUpCheckout } from '@loora/auth/credit-top-ups'
import { MAX_TOP_UP_CENTS, MIN_TOP_UP_CENTS } from '@loora/auth/top-up-policy'
import { sortCommitsOldestFirst, toHistoryPage } from './history'
import {
  DAILY_LIMIT_USD,
  WEEKLY_LIMIT_USD,
  getUsageStatus,
  listUserUsage,
  resetUsage,
} from '@loora/agent/usage'
import {
  disconnectGitHub,
  getGitHubStatus,
  githubEnabled,
  GitHubIntegrationError,
  listGitHubRepositories,
  syncGitHubInstallations,
} from '@loora/auth/github'
import { sanitizeChatMessagesForStorage } from './chat-storage'
import { summarizeMcpSessions } from './mcp-sessions'
import {
  disconnectFigma,
  FigmaIntegrationError,
  getFigmaStatus,
} from '@loora/auth/figma'
import { importFigmaDesign } from './figma-import'

type Session = Awaited<ReturnType<typeof getSession>>

export interface ORPCContext {
  session: Session
}

const shapeSchema = z.object({
  id: z.string(),
  name: z.string().max(200),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  // Rotation in degrees; permissive range so an out-of-range value never
  // rejects a whole design save (renderers normalize with mod 360).
  r: z.number().finite().optional(),
  code: z.string().max(200_000),
  groupId: z.string().max(128).optional(),
})

const requireUser = os.$context<ORPCContext>().middleware(async ({ context, next }) => {
  if (!context.session) throw new ORPCError('UNAUTHORIZED')
  if (!canUseApp(context.session.user)) {
    throw new ORPCError('FORBIDDEN', { message: 'Preview access is required.' })
  }
  if (!(await authorizeBilling(context.session.user)).access) {
    throw new ORPCError('FORBIDDEN', { message: 'An active Loora plan is required.' })
  }
  return next({ context: { user: context.session.user } })
})

const protectedProcedure = os.$context<ORPCContext>().use(requireUser)

const requireSignedInUser = os.$context<ORPCContext>().middleware(async ({ context, next }) => {
  if (!context.session) throw new ORPCError('UNAUTHORIZED')
  return next({ context: { user: context.session.user } })
})

const signedInProcedure = os.$context<ORPCContext>().use(requireSignedInUser)

const requirePreviewUser = os.$context<ORPCContext>().middleware(async ({ context, next }) => {
  if (!context.session) throw new ORPCError('UNAUTHORIZED')
  if (!canUseApp(context.session.user)) {
    throw new ORPCError('FORBIDDEN', { message: 'Preview access is required.' })
  }
  return next({ context: { user: context.session.user } })
})

const previewProcedure = os.$context<ORPCContext>().use(requirePreviewUser)

const requireAdmin = os.$context<ORPCContext>().middleware(async ({ context, next }) => {
  if (!context.session) throw new ORPCError('UNAUTHORIZED')
  if (!context.session.user.isAdmin) throw new ORPCError('FORBIDDEN')
  return next({ context: { user: context.session.user } })
})

const adminProcedure = os.$context<ORPCContext>().use(requireAdmin)

function shapeDiff(previous: CanvasElement[], next: CanvasElement[]) {
  const previousById = new Map(previous.map((shape) => [shape.id, shape]))
  const nextIds = new Set(next.map((shape) => shape.id))
  let added = 0
  let changed = 0
  for (const shape of next) {
    const old = previousById.get(shape.id)
    if (!old) added += 1
    else if (JSON.stringify(old) !== JSON.stringify(shape)) changed += 1
  }
  return {
    added,
    removed: previous.filter((shape) => !nextIds.has(shape.id)).length,
    changed,
  }
}

// Chats and versions can arrive before the debounced design save; make sure
// the parent row exists so their FKs hold. The real save upserts over this.
async function ensureDesign(designId: string, userId: string) {
  await db
    .insert(design)
    .values({ id: designId, userId, name: 'Untitled', shapes: [] })
    .onConflictDoNothing({ target: [design.id, design.userId] })
}

const listDesigns = protectedProcedure.handler(async ({ context }) => {
  return db
    .select({ id: design.id, name: design.name, updatedAt: design.updatedAt })
    .from(design)
    .where(eq(design.userId, context.user.id))
    .orderBy(asc(design.createdAt))
    .then((rows) => rows.map(({ updatedAt, ...row }) => ({ ...row, updatedAt: updatedAt.getTime() })))
})

const getDesign = protectedProcedure
  .input(z.object({ id: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const [found] = await db
      .select({ id: design.id, name: design.name, shapes: design.shapes, updatedAt: design.updatedAt })
      .from(design)
      .where(and(eq(design.id, input.id), eq(design.userId, context.user.id)))
      .limit(1)

    if (!found) throw new ORPCError('NOT_FOUND')
    return { ...found, updatedAt: found.updatedAt.getTime() }
  })

const saveDesign = protectedProcedure
  .input(
    z.object({
      id: z.string().min(1).max(128),
      name: z.string().trim().min(1).max(200),
      shapes: z.array(shapeSchema).max(10_000),
    }),
  )
  .handler(async ({ context, input }) => {
    const [saved] = await db
      .insert(design)
      .values({ ...input, userId: context.user.id })
      .onConflictDoUpdate({
        target: [design.id, design.userId],
        set: {
          name: input.name,
          shapes: input.shapes,
          updatedAt: new Date(),
        },
      })
      .returning({ id: design.id, updatedAt: design.updatedAt })

    return saved
  })

const deleteDesign = protectedProcedure
  .input(z.object({ id: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const deleted = await db
      .delete(design)
      .where(and(eq(design.id, input.id), eq(design.userId, context.user.id)))
      .returning({ id: design.id })

    return { deleted: deleted.length > 0 }
  })

const createDesignHandoff = protectedProcedure
  .input(z.object({ designId: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const [found] = await db
      .select({ id: design.id })
      .from(design)
      .where(and(eq(design.id, input.designId), eq(design.userId, context.user.id)))
      .limit(1)
    if (!found) throw new ORPCError('NOT_FOUND')
    return createHandoffToken(input.designId, context.user.id)
  })

const listVersions = protectedProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      limit: z.number().int().min(1).max(50).default(20),
      cursor: z
        .object({
          at: z.number().int().min(0).max(8_640_000_000_000_000),
          id: z.string().min(1).max(128),
        })
        .optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    const cursorDate = input.cursor ? new Date(input.cursor.at) : null
    const versions = await db
      .select({
        id: designVersion.id,
        message: designVersion.message,
        added: designVersion.added,
        removed: designVersion.removed,
        changed: designVersion.changed,
        createdAt: designVersion.createdAt,
      })
      .from(designVersion)
      .where(
        and(
          eq(designVersion.designId, input.designId),
          eq(designVersion.userId, context.user.id),
          cursorDate
            ? or(
                lt(designVersion.createdAt, cursorDate),
                and(eq(designVersion.createdAt, cursorDate), lt(designVersion.id, input.cursor!.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(designVersion.createdAt), desc(designVersion.id))
      .limit(input.limit + 1)

    return toHistoryPage(versions, input.limit)
  })

const compareVersion = protectedProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      id: z.string().min(1).max(128),
    }),
  )
  .handler(async ({ context, input }) => {
    const [current] = await db
      .select({
        id: designVersion.id,
        message: designVersion.message,
        shapes: designVersion.shapes,
        createdAt: designVersion.createdAt,
      })
      .from(designVersion)
      .where(
        and(
          eq(designVersion.id, input.id),
          eq(designVersion.designId, input.designId),
          eq(designVersion.userId, context.user.id),
        ),
      )
      .limit(1)

    if (!current) throw new ORPCError('NOT_FOUND')
    const [previous] = await db
      .select({
        id: designVersion.id,
        message: designVersion.message,
        shapes: designVersion.shapes,
        createdAt: designVersion.createdAt,
      })
      .from(designVersion)
      .where(
        and(
          eq(designVersion.designId, input.designId),
          eq(designVersion.userId, context.user.id),
          or(
            lt(designVersion.createdAt, current.createdAt),
            and(eq(designVersion.createdAt, current.createdAt), lt(designVersion.id, current.id)),
          ),
        ),
      )
      .orderBy(desc(designVersion.createdAt), desc(designVersion.id))
      .limit(1)

    const detail = (version: typeof current) => ({
      id: version.id,
      message: version.message,
      shapes: version.shapes,
      at: version.createdAt.getTime(),
    })
    return { current: detail(current), previous: previous ? detail(previous) : null }
  })

const importVersions = protectedProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      commits: z
        .array(
          z.object({
            id: z.string().min(1).max(128),
            message: z.string().trim().min(1).max(200),
            at: z.number().int().min(0).max(8_640_000_000_000_000),
            shapes: z.array(shapeSchema).max(10_000),
            added: z.number().int().nonnegative(),
            removed: z.number().int().nonnegative(),
            changed: z.number().int().nonnegative(),
          }),
        )
        .min(1)
        .max(50),
    }),
  )
  .handler(async ({ context, input }) => {
    await ensureDesign(input.designId, context.user.id)
    const queries = sortCommitsOldestFirst(input.commits).map((commit) => {
      const { at, ...values } = commit
      return db
        .insert(designVersion)
        .values({
          ...values,
          designId: input.designId,
          userId: context.user.id,
          createdAt: new Date(at),
        })
        .onConflictDoNothing({ target: [designVersion.id, designVersion.userId] })
    })
    await db.batch(queries as [typeof queries[number], ...typeof queries])
    return { processed: input.commits.length }
  })

const commitVersion = protectedProcedure
  .input(
    z.object({
      id: z.string().min(1).max(128),
      designId: z.string().min(1).max(128),
      message: z.string().trim().min(1).max(200),
      shapes: z.array(shapeSchema).max(10_000),
      skipIfUnchanged: z.boolean().optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    const [latest] = await db
      .select({ shapes: designVersion.shapes })
      .from(designVersion)
      .where(
        and(
          eq(designVersion.designId, input.designId),
          eq(designVersion.userId, context.user.id),
        ),
      )
      .orderBy(desc(designVersion.createdAt), desc(designVersion.id))
      .limit(1)

    if (
      input.skipIfUnchanged &&
      (input.shapes.length === 0 || JSON.stringify(latest?.shapes) === JSON.stringify(input.shapes))
    ) {
      return null
    }

    const changes = shapeDiff(latest?.shapes ?? [], input.shapes)
    await ensureDesign(input.designId, context.user.id)
    const [version] = await db
      .insert(designVersion)
      .values({
        id: input.id,
        designId: input.designId,
        userId: context.user.id,
        message: input.message,
        shapes: input.shapes,
        ...changes,
      })
      .returning()

    return {
      id: version.id,
      message: version.message,
      added: version.added,
      removed: version.removed,
      changed: version.changed,
      at: version.createdAt.getTime(),
    }
  })

const listChats = protectedProcedure
  .input(z.object({ designId: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const chats = await db
      .select({
        id: designChat.id,
        title: designChat.title,
        githubRepositoryId: designChat.githubRepositoryId,
        githubRepositoryFullName: designChat.githubRepositoryFullName,
        updatedAt: designChat.updatedAt,
      })
      .from(designChat)
      .where(
        and(eq(designChat.designId, input.designId), eq(designChat.userId, context.user.id)),
      )
      .orderBy(desc(designChat.updatedAt))

    return chats.map(({ updatedAt, ...chat }) => ({ ...chat, updatedAt: updatedAt.getTime() }))
  })

const createChat = protectedProcedure
  .input(
    z.object({
      id: z.string().min(1).max(128),
      designId: z.string().min(1).max(128),
      title: z.string().trim().min(1).max(200).default('New chat'),
    }),
  )
  .handler(async ({ context, input }) => {
    await ensureDesign(input.designId, context.user.id)
    const [repository] = await db
      .select({
        id: designGithubRepository.repositoryId,
        fullName: designGithubRepository.owner,
        name: designGithubRepository.name,
      })
      .from(designGithubRepository)
      .where(
        and(
          eq(designGithubRepository.designId, input.designId),
          eq(designGithubRepository.userId, context.user.id),
        ),
      )
      .limit(1)
    const [chat] = await db
      .insert(designChat)
      .values({
        ...input,
        userId: context.user.id,
        messages: [],
        githubRepositoryId: repository?.id ?? null,
        githubRepositoryFullName: repository
          ? `${repository.fullName}/${repository.name}`
          : null,
      })
      .onConflictDoNothing({ target: [designChat.id, designChat.userId] })
      .returning({
        id: designChat.id,
        title: designChat.title,
        githubRepositoryId: designChat.githubRepositoryId,
        githubRepositoryFullName: designChat.githubRepositoryFullName,
        updatedAt: designChat.updatedAt,
      })

    if (chat) return { ...chat, updatedAt: chat.updatedAt.getTime() }

    const [existing] = await db
      .select({
        id: designChat.id,
        title: designChat.title,
        githubRepositoryId: designChat.githubRepositoryId,
        githubRepositoryFullName: designChat.githubRepositoryFullName,
        updatedAt: designChat.updatedAt,
      })
      .from(designChat)
      .where(and(eq(designChat.id, input.id), eq(designChat.userId, context.user.id)))
      .limit(1)

    if (!existing) throw new ORPCError('INTERNAL_SERVER_ERROR')
    return { ...existing, updatedAt: existing.updatedAt.getTime() }
  })

const getChat = protectedProcedure
  .input(z.object({ id: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const [chat] = await db
      .select({ messages: designChat.messages })
      .from(designChat)
      .where(and(eq(designChat.id, input.id), eq(designChat.userId, context.user.id)))
      .limit(1)

    if (!chat) throw new ORPCError('NOT_FOUND')
    return { messages: chat.messages }
  })

const saveChat = protectedProcedure
  .input(
    z.object({
      id: z.string().min(1).max(128),
      title: z.string().trim().min(1).max(200),
      messages: z.array(z.unknown()).max(1_000),
    }),
  )
  .handler(async ({ context, input }) => {
    const saved = await db
      .update(designChat)
      .set({
        title: input.title,
        messages: sanitizeChatMessagesForStorage(input.messages),
        updatedAt: new Date(),
      })
      .where(and(eq(designChat.id, input.id), eq(designChat.userId, context.user.id)))
      .returning({ id: designChat.id })

    if (saved.length === 0) throw new ORPCError('NOT_FOUND')
    return { saved: input.messages.length }
  })

const deleteChat = protectedProcedure
  .input(z.object({ id: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const deleted = await db
      .delete(designChat)
      .where(and(eq(designChat.id, input.id), eq(designChat.userId, context.user.id)))
      .returning({ id: designChat.id })

    return { deleted: deleted.length > 0 }
  })

const MAX_ASSET_BYTES = 5 * 1024 * 1024

const listAssets = protectedProcedure.handler(async ({ context }) => {
  const assets = await db
    .select({
      id: asset.id,
      name: asset.name,
      mediaType: asset.mediaType,
      size: asset.size,
      createdAt: asset.createdAt,
    })
    .from(asset)
    .where(eq(asset.userId, context.user.id))
    .orderBy(desc(asset.createdAt))

  return assets.map(({ createdAt, ...a }) => ({ ...a, at: createdAt.getTime() }))
})

const uploadAsset = protectedProcedure
  .input(
    z.object({
      name: z.string().trim().min(1).max(200),
      mediaType: z.string().regex(/^image\/[\w.+-]+$/),
      data: z.string().min(1), // base64, no data: prefix
    }),
  )
  .handler(async ({ context, input }) => {
    const bytes = Buffer.from(input.data, 'base64')
    if (bytes.length > MAX_ASSET_BYTES) {
      throw new ORPCError('PAYLOAD_TOO_LARGE', { message: 'Assets are capped at 5MB.' })
    }
    const id = `a${crypto.randomUUID().replaceAll('-', '')}`

    let storageKey: string | null = null
    if (s3) {
      storageKey = assetKey(context.user.id, id)
      await s3.write(storageKey, bytes, { type: input.mediaType })
    }

    const [saved] = await db
      .insert(asset)
      .values({
        id,
        userId: context.user.id,
        name: input.name,
        mediaType: input.mediaType,
        size: bytes.length,
        storageKey,
        data: storageKey ? null : input.data,
      })
      .returning({ id: asset.id, name: asset.name, mediaType: asset.mediaType, size: asset.size })

    return saved
  })

const deleteAsset = protectedProcedure
  .input(z.object({ id: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const deleted = await db
      .delete(asset)
      .where(and(eq(asset.id, input.id), eq(asset.userId, context.user.id)))
      .returning({ id: asset.id, storageKey: asset.storageKey })

    const key = deleted[0]?.storageKey
    if (key && s3) {
      await s3.delete(key).catch((error) => console.error('[assets] S3 delete failed:', error))
    }
    return { deleted: deleted.length > 0 }
  })

const getCurrentUsage = protectedProcedure.handler(({ context }) =>
  getUsageStatus(context.user.id),
)

function githubProcedureError(error: unknown): never {
  if (error instanceof GitHubIntegrationError) {
    if (error.code === 'RECONNECT_REQUIRED') {
      throw new ORPCError('UNAUTHORIZED', { message: error.message })
    }
    if (error.code === 'ACCESS_DENIED') {
      throw new ORPCError('FORBIDDEN', { message: error.message })
    }
    if (error.code === 'RATE_LIMITED') {
      throw new ORPCError('TOO_MANY_REQUESTS', { message: error.message })
    }
    throw new ORPCError('BAD_REQUEST', { message: error.message })
  }
  throw error
}

function figmaProcedureError(error: unknown): never {
  if (error instanceof FigmaIntegrationError) {
    if (error.code === 'RECONNECT_REQUIRED') {
      throw new ORPCError('UNAUTHORIZED', { message: error.message })
    }
    if (error.code === 'ACCESS_DENIED') {
      throw new ORPCError('FORBIDDEN', { message: error.message })
    }
    if (error.code === 'RATE_LIMITED') {
      throw new ORPCError('TOO_MANY_REQUESTS', { message: error.message })
    }
    if (error.code === 'TOO_LARGE') {
      throw new ORPCError('PAYLOAD_TOO_LARGE', { message: error.message })
    }
    if (error.code === 'INVALID_FILE' || error.code === 'NOT_CONFIGURED') {
      throw new ORPCError('BAD_REQUEST', { message: error.message })
    }
    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: error.message })
  }
  throw error
}

const getFigmaConnection = protectedProcedure.handler(async ({ context }) => {
  try {
    return await getFigmaStatus(context.user.id)
  } catch (error) {
    return figmaProcedureError(error)
  }
})

const importFigma = protectedProcedure
  .input(
    z.object({
      url: z.string().trim().min(1).max(2_000),
      target: z
        .object({
          id: z.string().min(1).max(128),
          name: z.string().trim().min(1).max(200),
          shapes: z.array(shapeSchema).max(10_000),
        })
        .optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    try {
      return await importFigmaDesign(context.user.id, input.url, input.target)
    } catch (error) {
      return figmaProcedureError(error)
    }
  })

const disconnectFigmaAccount = protectedProcedure.handler(async ({ context }) => {
  try {
    return await disconnectFigma(context.user.id)
  } catch (error) {
    return figmaProcedureError(error)
  }
})

const getGithubStatus = protectedProcedure.handler(async ({ context }) => {
  try {
    return await getGitHubStatus(context.user.id)
  } catch (error) {
    return githubProcedureError(error)
  }
})

const listGithubRepositories = protectedProcedure.handler(async ({ context }) => {
  try {
    return await listGitHubRepositories(context.user.id)
  } catch (error) {
    return githubProcedureError(error)
  }
})

const refreshGithub = protectedProcedure.handler(async ({ context }) => {
  try {
    await syncGitHubInstallations(context.user.id)
    return await listGitHubRepositories(context.user.id)
  } catch (error) {
    return githubProcedureError(error)
  }
})

const getDesignGithubRepository = protectedProcedure
  .input(z.object({ designId: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const [repository] = await db
      .select({
        installationId: designGithubRepository.installationId,
        id: designGithubRepository.repositoryId,
        owner: designGithubRepository.owner,
        name: designGithubRepository.name,
        defaultBranch: designGithubRepository.defaultBranch,
      })
      .from(designGithubRepository)
      .where(
        and(
          eq(designGithubRepository.designId, input.designId),
          eq(designGithubRepository.userId, context.user.id),
        ),
      )
      .limit(1)
    return repository ? { ...repository, fullName: `${repository.owner}/${repository.name}` } : null
  })

const bindDesignGithubRepository = protectedProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      installationId: z.string().min(1).max(64),
      repositoryId: z.string().min(1).max(64),
    }),
  )
  .handler(async ({ context, input }) => {
    const [ownedDesign] = await db
      .select({ id: design.id })
      .from(design)
      .where(and(eq(design.id, input.designId), eq(design.userId, context.user.id)))
      .limit(1)
    if (!ownedDesign) throw new ORPCError('NOT_FOUND')

    try {
      const repositories = await listGitHubRepositories(context.user.id)
      const repository = repositories.find(
        (candidate) =>
          candidate.installationId === input.installationId &&
          candidate.id === input.repositoryId,
      )
      if (!repository) throw new ORPCError('FORBIDDEN', { message: 'Repository access was not granted.' })
      await db
        .insert(designGithubRepository)
        .values({
          designId: input.designId,
          userId: context.user.id,
          installationId: repository.installationId,
          repositoryId: repository.id,
          owner: repository.owner,
          name: repository.name,
          defaultBranch: repository.defaultBranch,
        })
        .onConflictDoUpdate({
          target: [designGithubRepository.designId, designGithubRepository.userId],
          set: {
            installationId: repository.installationId,
            repositoryId: repository.id,
            owner: repository.owner,
            name: repository.name,
            defaultBranch: repository.defaultBranch,
            updatedAt: new Date(),
          },
        })
      return {
        installationId: repository.installationId,
        id: repository.id,
        owner: repository.owner,
        name: repository.name,
        fullName: repository.fullName,
        defaultBranch: repository.defaultBranch,
      }
    } catch (error) {
      return githubProcedureError(error)
    }
  })

const clearDesignGithubRepository = protectedProcedure
  .input(z.object({ designId: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const deleted = await db
      .delete(designGithubRepository)
      .where(
        and(
          eq(designGithubRepository.designId, input.designId),
          eq(designGithubRepository.userId, context.user.id),
        ),
      )
      .returning({ id: designGithubRepository.repositoryId })
    return { cleared: deleted.length > 0 }
  })

const disconnectGithub = protectedProcedure.handler(async ({ context }) => {
  try {
    return await disconnectGitHub(context.user.id)
  } catch (error) {
    return githubProcedureError(error)
  }
})

const listMcpSessions = signedInProcedure.handler(async ({ context }) => {
  const rows = await db
    .select({
      clientId: oauthAccessToken.clientId,
      clientName: oauthApplication.name,
      createdAt: oauthAccessToken.createdAt,
      updatedAt: oauthAccessToken.updatedAt,
      accessTokenExpiresAt: oauthAccessToken.accessTokenExpiresAt,
      refreshTokenExpiresAt: oauthAccessToken.refreshTokenExpiresAt,
    })
    .from(oauthAccessToken)
    .leftJoin(oauthApplication, eq(oauthAccessToken.clientId, oauthApplication.clientId))
    .where(
      and(
        eq(oauthAccessToken.userId, context.user.id),
        isNotNull(oauthAccessToken.clientId),
      ),
    )
    .orderBy(desc(oauthAccessToken.updatedAt))

  return summarizeMcpSessions(rows)
})

const revokeMcpSession = signedInProcedure
  .input(z.object({ clientId: z.string().min(1).max(256) }))
  .handler(async ({ context, input }) => {
    const [tokens, consents] = await Promise.all([
      db
        .delete(oauthAccessToken)
        .where(
          and(
            eq(oauthAccessToken.userId, context.user.id),
            eq(oauthAccessToken.clientId, input.clientId),
          ),
        )
        .returning({ id: oauthAccessToken.id }),
      db
        .delete(oauthConsent)
        .where(
          and(
            eq(oauthConsent.userId, context.user.id),
            eq(oauthConsent.clientId, input.clientId),
          ),
        )
        .returning({ id: oauthConsent.id }),
    ])

    return { revoked: tokens.length > 0 || consents.length > 0 }
  })

const getAuthConfig = os.handler(() => ({ googleOAuthEnabled, githubEnabled }))

const getPreviewAccess = signedInProcedure.handler(async ({ context }) => {
  const [account] = await db
    .select({
      isAdmin: user.isAdmin,
      previewAccess: user.previewAccess,
      previewAccessRequestedAt: user.previewAccessRequestedAt,
    })
    .from(user)
    .where(eq(user.id, context.user.id))
    .limit(1)

  if (!account) throw new ORPCError('UNAUTHORIZED')
  const required = isPreviewAccessRequired()
  return {
    required,
    granted: canUseApp(account, required),
    requested: account.previewAccessRequestedAt !== null,
  }
})

const requestPreviewAccess = signedInProcedure.handler(async ({ context }) => {
  if (!isPreviewAccessRequired() || canUseApp(context.user)) {
    return { requested: false, granted: true }
  }

  await db
    .update(user)
    .set({ previewAccessRequestedAt: new Date(), updatedAt: new Date() })
    .where(eq(user.id, context.user.id))

  return { requested: true, granted: false }
})

const deleteAccount = signedInProcedure.handler(async ({ context }) => {
  // S3 objects don't cascade with the user row; collect and delete them first.
  if (s3) {
    const keys = await db
      .select({ storageKey: asset.storageKey })
      .from(asset)
      .where(and(eq(asset.userId, context.user.id), isNotNull(asset.storageKey)))
    for (const { storageKey } of keys) {
      if (storageKey) {
        await s3
          .delete(storageKey)
          .catch((error) => console.error('[account] S3 delete failed:', error))
      }
    }
  }

  // Everything else (designs, chats, sessions, oauth tokens, usage) cascades.
  await db.delete(user).where(eq(user.id, context.user.id))
  return { deleted: true }
})

const getCurrentBilling = previewProcedure.handler(({ context }) =>
  getBillingStatus(context.user),
)

const refreshCurrentBilling = previewProcedure.handler(({ context }) =>
  refreshBillingStatus(context.user),
)

const createSubscriptionCheckout = previewProcedure
  .input(z.object({ plan: z.enum(['pro', 'studio']) }))
  .handler(async ({ context, input }) => {
    const billing = await authorizeBilling(context.user)
    if (billing.access) {
      throw new ORPCError('FORBIDDEN', {
        message: 'Manage your existing subscription from Billing.',
      })
    }
    return createPlanCheckout(context.user.id, input.plan)
  })

const createCreditTopUp = protectedProcedure
  .input(z.object({
    amountCents: z.number().int().min(MIN_TOP_UP_CENTS).max(MAX_TOP_UP_CENTS),
  }))
  .handler(async ({ context, input }) => {
    const billing = await authorizeBilling(context.user)
    if (!billing.topUpAccess) {
      throw new ORPCError('FORBIDDEN', {
        message: 'Credit top-ups become available after the Pro trial.',
      })
    }
    return createTopUpCheckout(context.user.id, input.amountCents)
  })

const completeCreditTopUp = previewProcedure
  .input(z.object({ checkoutId: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const order = await completeTopUpCheckout(context.user.id, input.checkoutId)
    return {
      completed: order !== null,
      addedCredits: order?.creditUnits ?? 0,
      billing: await getBillingStatus(context.user),
    }
  })

const listUsersWithUsage = adminProcedure.handler(() => listUserUsage())

const resetUserUsage = adminProcedure
  .input(z.object({ userId: z.string().min(1).max(128) }))
  .handler(async ({ input }) => ({ deleted: await resetUsage(input.userId) }))

const setUserUsageMultiplier = adminProcedure
  .input(
    z.object({
      userId: z.string().min(1).max(128),
      multiplier: z.number().int().min(1).max(1_000_000),
    }),
  )
  .handler(async ({ input }) => {
    const [updated] = await db
      .update(user)
      .set({ usageMultiplier: input.multiplier, updatedAt: new Date() })
      .where(eq(user.id, input.userId))
      .returning({ userId: user.id, usageMultiplier: user.usageMultiplier })

    if (!updated) throw new ORPCError('NOT_FOUND')
    return {
      ...updated,
      dailyLimitUsd: DAILY_LIMIT_USD * updated.usageMultiplier,
      weeklyLimitUsd: WEEKLY_LIMIT_USD * updated.usageMultiplier,
    }
  })

const setUserPreviewAccess = adminProcedure
  .input(
    z.object({
      userId: z.string().min(1).max(128),
      granted: z.boolean(),
    }),
  )
  .handler(async ({ input }) => {
    const [updated] = await db
      .update(user)
      .set({
        previewAccess: input.granted,
        previewAccessRequestedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(user.id, input.userId))
      .returning({ userId: user.id, previewAccess: user.previewAccess })

    if (!updated) throw new ORPCError('NOT_FOUND')
    return updated
  })

const getPreferences = protectedProcedure.handler(async ({ context }) => {
  const [row] = await db
    .select({
      shortcuts: userPreferences.shortcuts,
      agentSystemPrompt: userPreferences.agentSystemPrompt,
    })
    .from(userPreferences)
    .where(eq(userPreferences.userId, context.user.id))
    .limit(1)
  return {
    shortcuts: row ? parseShortcutConfig(row.shortcuts) : { ...EMPTY_SHORTCUT_CONFIG, custom: [] },
    agentSystemPrompt: row?.agentSystemPrompt ?? '',
  }
})

const savePreferences = protectedProcedure
  .input(z.object({ shortcuts: shortcutConfigSchema }))
  .handler(async ({ context, input }) => {
    const shortcuts = parseShortcutConfig(input.shortcuts)
    await db
      .insert(userPreferences)
      .values({
        userId: context.user.id,
        shortcuts,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: {
          shortcuts,
          updatedAt: new Date(),
        },
      })
    return { shortcuts }
  })

const saveAgentPrompt = protectedProcedure
  .input(z.object({ prompt: agentSystemPromptSchema }))
  .handler(async ({ context, input }) => {
    const agentSystemPrompt = input.prompt
    await db
      .insert(userPreferences)
      .values({
        userId: context.user.id,
        agentSystemPrompt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: {
          agentSystemPrompt,
          updatedAt: new Date(),
        },
      })
    return { agentSystemPrompt }
  })

export const appRouter = {
  auth: {
    config: getAuthConfig,
    previewAccess: getPreviewAccess,
    requestPreviewAccess,
    deleteAccount,
  },
  preferences: {
    get: getPreferences,
    save: savePreferences,
    saveAgentPrompt,
  },
  billing: {
    status: getCurrentBilling,
    refresh: refreshCurrentBilling,
    checkout: createSubscriptionCheckout,
    createTopUp: createCreditTopUp,
    completeTopUp: completeCreditTopUp,
  },
  design: {
    list: listDesigns,
    get: getDesign,
    save: saveDesign,
    delete: deleteDesign,
  },
  handoff: {
    create: createDesignHandoff,
  },
  history: {
    list: listVersions,
    compare: compareVersion,
    import: importVersions,
    commit: commitVersion,
  },
  chat: {
    list: listChats,
    create: createChat,
    get: getChat,
    save: saveChat,
    delete: deleteChat,
  },
  asset: {
    list: listAssets,
    upload: uploadAsset,
    delete: deleteAsset,
  },
  usage: {
    get: getCurrentUsage,
  },
  github: {
    status: getGithubStatus,
    repositories: listGithubRepositories,
    refresh: refreshGithub,
    binding: getDesignGithubRepository,
    bind: bindDesignGithubRepository,
    clear: clearDesignGithubRepository,
    disconnect: disconnectGithub,
  },
  figma: {
    status: getFigmaConnection,
    import: importFigma,
    disconnect: disconnectFigmaAccount,
  },
  mcp: {
    sessions: listMcpSessions,
    revoke: revokeMcpSession,
  },
  admin: {
    listUsers: listUsersWithUsage,
    resetUsage: resetUserUsage,
    setUsageMultiplier: setUserUsageMultiplier,
    setPreviewAccess: setUserPreviewAccess,
  },
}
