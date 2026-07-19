import { and, asc, desc, eq } from 'drizzle-orm'
import { ORPCError, os } from '@orpc/server'
import { z } from 'zod'
import { db } from '#/db'
import { asset, design, designChat, designVersion, user } from '#/db/schema'
import { googleOAuthEnabled, type getSession } from '#/lib/auth'
import type { CanvasElement } from '#/lib/canvas'
import type { UIMessage } from 'ai'
import { assetKey, s3 } from '#/lib/storage'
import { createHandoffToken } from '#/lib/handoff-token'
import {
  DAILY_LIMIT_USD,
  WEEKLY_LIMIT_USD,
  getUsageStatus,
  listUserUsage,
  resetUsage,
} from '#/lib/ai-limits'

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
  code: z.string().max(200_000),
  groupId: z.string().max(128).optional(),
})

const requireUser = os.$context<ORPCContext>().middleware(async ({ context, next }) => {
  if (!context.session) throw new ORPCError('UNAUTHORIZED')
  return next({ context: { user: context.session.user } })
})

const protectedProcedure = os.$context<ORPCContext>().use(requireUser)

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
    .select({ id: design.id, name: design.name, shapes: design.shapes })
    .from(design)
    .where(eq(design.userId, context.user.id))
    .orderBy(asc(design.createdAt))
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
        set: { name: input.name, shapes: input.shapes, updatedAt: new Date() },
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
  .input(z.object({ designId: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const versions = await db
      .select()
      .from(designVersion)
      .where(
        and(
          eq(designVersion.designId, input.designId),
          eq(designVersion.userId, context.user.id),
        ),
      )
      .orderBy(desc(designVersion.createdAt))

    return versions.map(({ createdAt, userId: _userId, designId: _designId, ...version }) => ({
      ...version,
      at: createdAt.getTime(),
    }))
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
      .orderBy(desc(designVersion.createdAt))
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
      shapes: version.shapes,
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
      .select({ id: designChat.id, title: designChat.title, updatedAt: designChat.updatedAt })
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
    const [chat] = await db
      .insert(designChat)
      .values({ ...input, userId: context.user.id, messages: [] })
      .onConflictDoNothing({ target: [designChat.id, designChat.userId] })
      .returning({ id: designChat.id, title: designChat.title, updatedAt: designChat.updatedAt })

    if (chat) return { ...chat, updatedAt: chat.updatedAt.getTime() }

    const [existing] = await db
      .select({ id: designChat.id, title: designChat.title, updatedAt: designChat.updatedAt })
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
        messages: input.messages as UIMessage[],
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

const getAuthConfig = os.handler(() => ({ googleOAuthEnabled }))

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

export const appRouter = {
  auth: {
    config: getAuthConfig,
  },
  design: {
    list: listDesigns,
    save: saveDesign,
    delete: deleteDesign,
  },
  handoff: {
    create: createDesignHandoff,
  },
  history: {
    list: listVersions,
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
  admin: {
    listUsers: listUsersWithUsage,
    resetUsage: resetUserUsage,
    setUsageMultiplier: setUserUsageMultiplier,
  },
}
