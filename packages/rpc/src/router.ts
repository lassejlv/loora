import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  or,
  sql,
  sum,
} from 'drizzle-orm'
import { ORPCError, os } from '@orpc/server'
import { z } from 'zod'
import { db } from '@loora/db'
import {
  asset,
  billingEntitlement,
  canvasTransaction as canvasTransactionLog,
  design,
  designDraft,
  designGithubRepository,
  designShare,
  designVersion,
  oauthAccessToken,
  oauthApplication,
  oauthConsent,
  publishLink,
  session as authSession,
  user,
  userPreferences,
} from '@loora/db/schema'
import {
  CanvasConflictError,
  CanvasEngine,
  parseCanvasTransaction,
  withTransactionPreconditions,
  type CanvasTransaction,
} from '@loora/canvas/engine'
import {
  CANVAS_SCHEMA_VERSION,
  createCanvasDocument,
  parseCanvasDocument,
  type CanvasDocument,
} from '@loora/canvas/model'
import {
  diffDocuments,
  mergeDocuments,
  type CanvasMergeConflict,
  type CanvasMergeResolutions,
} from '@loora/canvas/merge'
import { EMPTY_SHORTCUT_CONFIG } from '@loora/db/shortcuts'
import {
  allows,
  claimDesignShares,
  isEmail,
  listDesignCollaborators,
  listSharedDesigns,
  normalizeEmail,
  resolveDesignAccess,
  type DesignRole,
} from '@loora/db/design-access'
import {
  publishCanvasRealtimeEvent,
  readCanvasAgentActivity,
} from '@loora/db/canvas-realtime'
import { canvasTransactionPruneBefore } from '@loora/db/canvas-transactions'
import { parseShortcutConfig, shortcutConfigSchema } from './shortcuts'
import { googleOAuthEnabled, type getSession } from '@loora/auth'
import { type CanvasElement, type CanvasPage } from '@loora/db/canvas'
import {
  mergeCanvas,
  type MergeChoice,
} from '@loora/db/drafts'
import { assetKey, s3 } from './storage'
import { createHandoffToken } from './handoff-token'
import {
  authorizeBilling,
  createPlanCheckout,
  getBillingStatus,
  refreshBillingStatus,
  refreshEntitlement,
} from '@loora/billing/billing'
import {
  getMcpUsage,
  McpUsageUnavailableError,
  resolveMcpUsagePlan,
} from '@loora/billing/mcp-usage'
import {
  historyCutoffForCapacity,
  pruneExpiredHistoryForUser,
  requireDesignFileRoom,
  requireHistoryVersionAccessible,
  requireOpenBranchRoom,
  requireStorageRoom,
  resolveHistoryCapacity,
} from '@loora/billing/enforce-plan-limits'
import { PlanLimitError } from '@loora/billing/plan-limits'
import { canUseApp, isPreviewAccessRequired } from '@loora/auth/preview-access'
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  hasAcceptedCurrentLegal,
} from '@loora/auth/legal-consent'
import { sortCommitsOldestFirst, toHistoryPage } from './history'
import {
  disconnectGitHub,
  getGitHubStatus,
  githubEnabled,
  GitHubIntegrationError,
  listGitHubRepositories,
  syncGitHubInstallations,
} from '@loora/auth/github'
import { summarizeMcpSessions } from './mcp-sessions'

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
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
})

const pageItemSchema = z.object({
  id: z.string().min(1).max(128),
  elementId: z.string().min(1).max(128),
  height: z.number().finite().min(1).max(100_000),
})

const pageSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(200),
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().min(1).max(100_000),
  items: z.array(pageItemSchema).max(10_000),
})

const draftIdSchema = z.string().min(1).max(128)
const optionalDraftIdSchema = draftIdSchema.nullish()
const draftTargetWhere = (draftId: string | null | undefined) =>
  draftId ? eq(designVersion.draftId, draftId) : isNull(designVersion.draftId)

const requireUser = os.$context<ORPCContext>().middleware(async ({ context, next }) => {
  if (!context.session) throw new ORPCError('UNAUTHORIZED')
  if (!hasAcceptedCurrentLegal(context.session.user)) {
    throw new ORPCError('FORBIDDEN', {
      message: 'The current Terms of Service and Privacy Policy must be accepted.',
    })
  }
  if (!canUseApp(context.session.user)) {
    throw new ORPCError('FORBIDDEN', { message: 'Preview access is required.' })
  }
  if (!(await authorizeBilling(context.session.user)).access) {
    throw new ORPCError('FORBIDDEN', { message: 'An active Loora plan is required.' })
  }
  return next({ context: { user: context.session.user } })
})

const protectedProcedure = os.$context<ORPCContext>().use(requireUser)

function planLimitOrpcError(error: unknown): never {
  if (error instanceof PlanLimitError) {
    throw new ORPCError('FORBIDDEN', {
      message: error.message,
      data: { code: error.code, limit: error.limit },
    })
  }
  throw error
}

async function ensureDesignFileRoom(user: { id: string; isAdmin?: boolean | null }) {
  try {
    await requireDesignFileRoom(user)
  } catch (error) {
    planLimitOrpcError(error)
  }
}

async function ensureOpenBranchRoom(
  user: { id: string; isAdmin?: boolean | null },
  designId: string,
) {
  try {
    await requireOpenBranchRoom(user, designId)
  } catch (error) {
    planLimitOrpcError(error)
  }
}

async function ensureStorageRoom(
  user: { id: string; isAdmin?: boolean | null },
  incomingBytes: number,
) {
  try {
    await requireStorageRoom(user, incomingBytes)
  } catch (error) {
    planLimitOrpcError(error)
  }
}

async function ensureHistoryVersionAccessible(
  user: { id: string; isAdmin?: boolean | null },
  createdAt: Date,
) {
  try {
    await requireHistoryVersionAccessible(user, createdAt)
  } catch (error) {
    planLimitOrpcError(error)
  }
}

/** Best-effort prune of out-of-window versions after history writes/lists. */
function scheduleHistoryPrune(user: { id: string; isAdmin?: boolean | null }) {
  void pruneExpiredHistoryForUser(user).catch((error) => {
    console.error('[history] prune failed:', error)
  })
}

const requireSignedInUser = os.$context<ORPCContext>().middleware(async ({ context, next }) => {
  if (!context.session) throw new ORPCError('UNAUTHORIZED')
  return next({ context: { user: context.session.user } })
})

const signedInProcedure = os.$context<ORPCContext>().use(requireSignedInUser)

const requireConsentedUser = os.$context<ORPCContext>().middleware(async ({ context, next }) => {
  if (!context.session) throw new ORPCError('UNAUTHORIZED')
  if (!hasAcceptedCurrentLegal(context.session.user)) {
    throw new ORPCError('FORBIDDEN', {
      message: 'The current Terms of Service and Privacy Policy must be accepted.',
    })
  }
  return next({ context: { user: context.session.user } })
})

const consentedProcedure = os.$context<ORPCContext>().use(requireConsentedUser)

const requirePreviewUser = os.$context<ORPCContext>().middleware(async ({ context, next }) => {
  if (!context.session) throw new ORPCError('UNAUTHORIZED')
  if (!hasAcceptedCurrentLegal(context.session.user)) {
    throw new ORPCError('FORBIDDEN', {
      message: 'The current Terms of Service and Privacy Policy must be accepted.',
    })
  }
  if (!canUseApp(context.session.user)) {
    throw new ORPCError('FORBIDDEN', { message: 'Preview access is required.' })
  }
  return next({ context: { user: context.session.user } })
})

const previewProcedure = os.$context<ORPCContext>().use(requirePreviewUser)

const requireAdmin = os.$context<ORPCContext>().middleware(async ({ context, next }) => {
  if (!context.session) throw new ORPCError('UNAUTHORIZED')
  if (!hasAcceptedCurrentLegal(context.session.user)) {
    throw new ORPCError('FORBIDDEN', {
      message: 'The current Terms of Service and Privacy Policy must be accepted.',
    })
  }
  if (!context.session.user.isAdmin) throw new ORPCError('FORBIDDEN')
  return next({ context: { user: context.session.user } })
})

const adminProcedure = os.$context<ORPCContext>().use(requireAdmin)

function collectionDiff<T extends { id: string }>(previous: T[], next: T[]) {
  const previousById = new Map(previous.map((item) => [item.id, item]))
  const nextIds = new Set(next.map((item) => item.id))
  let added = 0
  let changed = 0
  for (const item of next) {
    const old = previousById.get(item.id)
    if (!old) added += 1
    else if (JSON.stringify(old) !== JSON.stringify(item)) changed += 1
  }
  return {
    added,
    removed: previous.filter((item) => !nextIds.has(item.id)).length,
    changed,
  }
}

function documentDiff(
  previousShapes: CanvasElement[],
  nextShapes: CanvasElement[],
  previousPages: CanvasPage[],
  nextPages: CanvasPage[],
) {
  const shapes = collectionDiff(previousShapes, nextShapes)
  const pages = collectionDiff(previousPages, nextPages)
  return {
    added: shapes.added + pages.added,
    removed: shapes.removed + pages.removed,
    changed: shapes.changed + pages.changed,
  }
}

// Chats and versions can arrive before the debounced design save; make sure
// the parent row exists so their FKs hold. The real save upserts over this.
/**
 * A design id on its own does not say whose design it is — designs are keyed by
 * (id, ownerUserId) — so every design-scoped call resolves the viewer's standing
 * before it touches a row. Owners are still held to the plan their designs are
 * billed under; someone working in a design shared with them rides the owner's.
 */
async function requireDesignAccess(
  viewer: { id: string; email: string } & Record<string, unknown>,
  designId: string,
  required: DesignRole = 'view',
) {
  const access = await resolveDesignAccess(designId, {
    id: viewer.id,
    email: viewer.email,
  })
  if (!access) throw new ORPCError('NOT_FOUND')
  if (access.role === 'owner') {
    if (!canUseApp(viewer as Parameters<typeof canUseApp>[0])) {
      throw new ORPCError('FORBIDDEN', { message: 'Preview access is required.' })
    }
    if (
      !(await authorizeBilling(viewer as Parameters<typeof authorizeBilling>[0]))
        .access
    ) {
      throw new ORPCError('FORBIDDEN', { message: 'An active Loora plan is required.' })
    }
  }
  if (!allows(access.role, required)) {
    throw new ORPCError('FORBIDDEN', {
      message: 'You have view-only access to this design.',
    })
  }
  return access
}

async function ensureDesign(
  designId: string,
  user: { id: string; isAdmin?: boolean | null },
) {
  const [existing] = await db
    .select({ id: design.id })
    .from(design)
    .where(and(eq(design.id, designId), eq(design.userId, user.id)))
    .limit(1)
  if (existing) return
  await ensureDesignFileRoom(user)
  await db
    .insert(design)
    .values({ id: designId, userId: user.id, name: 'Untitled', shapes: [], pages: [] })
    .onConflictDoNothing({ target: [design.id, design.userId] })
}

const listDesigns = protectedProcedure.handler(async ({ context }) => {
  return db
    .select({
      id: design.id,
      name: design.name,
      revision: design.revision,
      updatedAt: design.updatedAt,
    })
    .from(design)
    .where(eq(design.userId, context.user.id))
    .orderBy(asc(design.createdAt))
    .then((rows) => rows.map(({ updatedAt, ...row }) => ({ ...row, updatedAt: updatedAt.getTime() })))
})

const getDesign = protectedProcedure
  .input(z.object({ id: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const [found] = await db
      .select({
        id: design.id,
        name: design.name,
        shapes: design.shapes,
        pages: design.pages,
        revision: design.revision,
        updatedAt: design.updatedAt,
      })
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
      pages: z.array(pageSchema).max(1_000).default([]),
      expectedRevision: z.number().int().nonnegative().optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    const { expectedRevision, ...values } = input
    const [existing] = await db
      .select({ revision: design.revision })
      .from(design)
      .where(and(eq(design.id, input.id), eq(design.userId, context.user.id)))
      .limit(1)

    if (!existing) {
      await ensureDesignFileRoom(context.user)
      const [created] = await db
        .insert(design)
        .values({ ...values, userId: context.user.id })
        .returning({
          id: design.id,
          revision: design.revision,
          updatedAt: design.updatedAt,
        })
      return { ...created, updatedAt: created.updatedAt.getTime() }
    }

    if (expectedRevision !== undefined && expectedRevision !== existing.revision) {
      throw new ORPCError('CONFLICT', { message: 'Main changed since it was loaded.' })
    }

    const [saved] = await db
      .update(design)
      .set({
        name: input.name,
        shapes: input.shapes,
        pages: input.pages,
        revision: existing.revision + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(design.id, input.id),
          eq(design.userId, context.user.id),
          eq(design.revision, existing.revision),
        ),
      )
      .returning({
        id: design.id,
        revision: design.revision,
        updatedAt: design.updatedAt,
      })

    if (!saved) throw new ORPCError('CONFLICT', { message: 'Main changed while it was saving.' })
    return { ...saved, updatedAt: saved.updatedAt.getTime() }
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

const designIdInput = z.object({ designId: z.string().min(1).max(128) })

const shareRoleInput = z.enum(['view', 'edit'])

/** What the share dialog renders: link mode, everyone invited, and my standing. */
const getDesignShare = consentedProcedure
  .input(designIdInput)
  .handler(async ({ context, input }) => {
    // Opening the design is what turns an invitation addressed to an email
    // into a grant held by an account.
    await claimDesignShares({ id: context.user.id, email: context.user.email })
    const access = await requireDesignAccess(context.user, input.designId)
    const collaborators =
      access.role === 'owner'
        ? await listDesignCollaborators(input.designId, access.ownerUserId)
        : []
    const [owner] = await db
      .select({ id: user.id, name: user.name, email: user.email, image: user.image })
      .from(user)
      .where(eq(user.id, access.ownerUserId))
      .limit(1)
    return {
      role: access.role,
      source: access.source,
      linkAccess: access.linkAccess,
      owner: owner ?? null,
      collaborators: collaborators.map((collaborator) => ({
        ...collaborator,
        acceptedAt: collaborator.acceptedAt?.getTime() ?? null,
        createdAt: collaborator.createdAt.getTime(),
      })),
    }
  })

const setDesignLinkAccess = consentedProcedure
  .input(
    designIdInput.extend({
      linkAccess: z.enum(['restricted', 'view', 'edit']),
    }),
  )
  .handler(async ({ context, input }) => {
    const access = await requireDesignAccess(context.user, input.designId, 'owner')
    await db
      .update(design)
      .set({ linkAccess: input.linkAccess })
      .where(
        and(
          eq(design.id, input.designId),
          eq(design.userId, access.ownerUserId),
        ),
      )
    return { linkAccess: input.linkAccess }
  })

const inviteDesignCollaborator = consentedProcedure
  .input(
    designIdInput.extend({
      email: z.string().trim().min(3).max(320),
      role: shareRoleInput,
    }),
  )
  .handler(async ({ context, input }) => {
    const access = await requireDesignAccess(context.user, input.designId, 'owner')
    const email = normalizeEmail(input.email)
    if (!isEmail(email)) {
      throw new ORPCError('BAD_REQUEST', { message: 'Enter a valid email address.' })
    }
    if (email === normalizeEmail(context.user.email)) {
      throw new ORPCError('BAD_REQUEST', { message: 'You already own this design.' })
    }
    const existing = await listDesignCollaborators(
      input.designId,
      access.ownerUserId,
    )
    if (
      existing.length >= 100 &&
      !existing.some((collaborator) => collaborator.email === email)
    ) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'A design can be shared with at most 100 people.',
      })
    }
    // An invitation may be written before that person has an account, so the
    // account is looked up opportunistically and filled in on their first visit
    // otherwise.
    const [account] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .limit(1)
    await db
      .insert(designShare)
      .values({
        id: crypto.randomUUID(),
        designId: input.designId,
        ownerUserId: access.ownerUserId,
        email,
        role: input.role,
        invitedByUserId: context.user.id,
        userId: account?.id ?? null,
      })
      .onConflictDoUpdate({
        target: [designShare.designId, designShare.ownerUserId, designShare.email],
        set: { role: input.role, updatedAt: new Date() },
      })
    return { email, role: input.role }
  })

const setDesignCollaboratorRole = consentedProcedure
  .input(designIdInput.extend({ shareId: z.string().min(1).max(128), role: shareRoleInput }))
  .handler(async ({ context, input }) => {
    const access = await requireDesignAccess(context.user, input.designId, 'owner')
    const [updated] = await db
      .update(designShare)
      .set({ role: input.role })
      .where(
        and(
          eq(designShare.id, input.shareId),
          eq(designShare.designId, input.designId),
          eq(designShare.ownerUserId, access.ownerUserId),
        ),
      )
      .returning({ id: designShare.id })
    if (!updated) throw new ORPCError('NOT_FOUND')
    return { id: updated.id, role: input.role }
  })

const revokeDesignCollaborator = consentedProcedure
  .input(designIdInput.extend({ shareId: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const access = await requireDesignAccess(context.user, input.designId, 'owner')
    const removed = await db
      .delete(designShare)
      .where(
        and(
          eq(designShare.id, input.shareId),
          eq(designShare.designId, input.designId),
          eq(designShare.ownerUserId, access.ownerUserId),
        ),
      )
      .returning({ id: designShare.id })
    return { revoked: removed.length > 0 }
  })

/** Removes yourself from a design somebody else shared with you. */
const leaveDesignShare = consentedProcedure
  .input(designIdInput)
  .handler(async ({ context, input }) => {
    const access = await requireDesignAccess(context.user, input.designId)
    if (access.role === 'owner') {
      throw new ORPCError('BAD_REQUEST', { message: 'The owner cannot leave a design.' })
    }
    const removed = await db
      .delete(designShare)
      .where(
        and(
          eq(designShare.designId, input.designId),
          eq(designShare.ownerUserId, access.ownerUserId),
          or(
            eq(designShare.userId, context.user.id),
            eq(designShare.email, normalizeEmail(context.user.email)),
          ),
        ),
      )
      .returning({ id: designShare.id })
    return { left: removed.length > 0 }
  })

const listDesignsSharedWithMe = consentedProcedure.handler(async ({ context }) => {
  await claimDesignShares({ id: context.user.id, email: context.user.email })
  const designs = await listSharedDesigns({
    id: context.user.id,
    email: context.user.email,
  })
  return designs.map((entry) => ({
    ...entry,
    updatedAt: entry.updatedAt.getTime(),
  }))
})

const canvasTargetKey = (draftId: string | null | undefined) =>
  draftId ? `draft:${draftId}` : 'main'

const canvasTargetInput = z.object({
  designId: z.string().min(1).max(128),
  draftId: optionalDraftIdSchema,
})

const createCanvasDesign = protectedProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      name: z.string().trim().min(1).max(200),
      document: z.unknown(),
    }),
  )
  .handler(async ({ context, input }) => {
    const document = parseCanvasDocument(input.document)
    if (document.id !== input.designId) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'Canvas document id must match the design id.',
      })
    }
    // Idempotent create: only charge the Free file cap when a new row is
    // actually inserted. Conflict → existing id is not a new file.
    const [existingBefore] = await db
      .select({ id: design.id })
      .from(design)
      .where(and(eq(design.id, input.designId), eq(design.userId, context.user.id)))
      .limit(1)
    if (!existingBefore) await ensureDesignFileRoom(context.user)
    const [created] = await db
      .insert(design)
      .values({
        id: input.designId,
        userId: context.user.id,
        name: input.name,
        shapes: [],
        pages: [],
        canvasVersion: CANVAS_SCHEMA_VERSION,
        canvasDocument: { ...document, name: input.name },
      })
      .onConflictDoNothing({ target: [design.id, design.userId] })
      .returning({
        id: design.id,
        revision: design.revision,
        document: design.canvasDocument,
      })
    if (created) {
      return {
        created: true as const,
        id: created.id,
        revision: created.revision,
        document: parseCanvasDocument(created.document),
      }
    }
    const [existing] = await db
      .select({
        id: design.id,
        version: design.canvasVersion,
        revision: design.revision,
        document: design.canvasDocument,
      })
      .from(design)
      .where(and(eq(design.id, input.designId), eq(design.userId, context.user.id)))
      .limit(1)
    if (!existing) throw new ORPCError('CONFLICT')
    if (existing.version !== CANVAS_SCHEMA_VERSION || !existing.document) {
      throw new ORPCError('CONFLICT', { message: 'UNSUPPORTED_CANVAS' })
    }
    return {
      created: false as const,
      id: existing.id,
      revision: existing.revision,
      document: parseCanvasDocument(existing.document),
    }
  })

const renameCanvasDesign = consentedProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      name: z.string().trim().min(1).max(200),
      expectedRevision: z.number().int().nonnegative(),
    }),
  )
  .handler(async ({ context, input }) => {
    const access = await requireDesignAccess(
      context.user,
      input.designId,
      'edit',
    )
    const [target] = await db
      .select({
        document: design.canvasDocument,
        version: design.canvasVersion,
        revision: design.revision,
      })
      .from(design)
      .where(and(eq(design.id, input.designId), eq(design.userId, access.ownerUserId)))
      .limit(1)
    if (!target) throw new ORPCError('NOT_FOUND')
    if (target.version !== CANVAS_SCHEMA_VERSION || !target.document) {
      throw new ORPCError('CONFLICT', { message: 'UNSUPPORTED_CANVAS' })
    }
    if (target.revision !== input.expectedRevision) {
      throw new ORPCError('CONFLICT', {
        message: 'Main changed before it could be renamed.',
      })
    }
    const document = parseCanvasDocument(target.document)
    const renamedDocument: CanvasDocument = {
      ...document,
      name: input.name,
      metadata: { ...document.metadata, updatedAt: Date.now() },
    }
    const [updated] = await db
      .update(design)
      .set({
        name: input.name,
        canvasDocument: renamedDocument,
        revision: target.revision + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(design.id, input.designId),
          eq(design.userId, access.ownerUserId),
          eq(design.revision, target.revision),
        ),
      )
      .returning({ revision: design.revision })
    if (!updated) {
      throw new ORPCError('CONFLICT', {
        message: 'Main changed while it was being renamed.',
      })
    }
    return {
      renamed: true as const,
      revision: updated.revision,
      document: renamedDocument,
    }
  })

async function canvasInterveningTransactions(
  userId: string,
  designId: string,
  draftId: string | null | undefined,
  revision: number,
  throughRevision: number,
) {
  return db
    .select({
      revision: canvasTransactionLog.revision,
      transaction: canvasTransactionLog.transaction,
    })
    .from(canvasTransactionLog)
    .where(
      and(
        eq(canvasTransactionLog.userId, userId),
        eq(canvasTransactionLog.designId, designId),
        eq(canvasTransactionLog.targetKey, canvasTargetKey(draftId)),
        gt(canvasTransactionLog.revision, revision),
        lte(canvasTransactionLog.revision, throughRevision),
      ),
    )
    .orderBy(asc(canvasTransactionLog.revision))
    .limit(101)
}

async function canvasTargetSnapshot(
  userId: string,
  designId: string,
  draftId: string | null | undefined,
) {
  return draftId
    ? db
        .select({
          version: designDraft.canvasVersion,
          document: designDraft.canvasDocument,
          revision: designDraft.revision,
        })
        .from(designDraft)
        .where(
          and(
            eq(designDraft.id, draftId),
            eq(designDraft.designId, designId),
            eq(designDraft.userId, userId),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null)
    : db
        .select({
          version: design.canvasVersion,
          document: design.canvasDocument,
          revision: design.revision,
        })
        .from(design)
        .where(and(eq(design.id, designId), eq(design.userId, userId)))
        .limit(1)
        .then((rows) => rows[0] ?? null)
}

const getCanvas = consentedProcedure
  .input(
    canvasTargetInput.extend({
      sinceRevision: z.number().int().nonnegative().optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    // Rows belong to the owner, whoever is reading them.
    const access = await requireDesignAccess(
      context.user,
      input.designId,
      'view',
    )
    const targetPromise =
      input.sinceRevision === undefined
        ? input.draftId
          ? db
              .select({
                version: designDraft.canvasVersion,
                document: designDraft.canvasDocument,
                revision: designDraft.revision,
              })
              .from(designDraft)
              .where(
                and(
                  eq(designDraft.id, input.draftId),
                  eq(designDraft.designId, input.designId),
                  eq(designDraft.userId, access.ownerUserId),
                ),
              )
              .limit(1)
              .then((rows) => rows[0])
          : db
              .select({
                version: design.canvasVersion,
                document: design.canvasDocument,
                revision: design.revision,
              })
              .from(design)
              .where(
                and(
                  eq(design.id, input.designId),
                  eq(design.userId, access.ownerUserId),
                ),
              )
              .limit(1)
              .then((rows) => rows[0])
        : input.draftId
          ? db
              .select({
                version: designDraft.canvasVersion,
                revision: designDraft.revision,
              })
              .from(designDraft)
              .where(
                and(
                  eq(designDraft.id, input.draftId),
                  eq(designDraft.designId, input.designId),
                  eq(designDraft.userId, access.ownerUserId),
                ),
              )
              .limit(1)
              .then((rows) => rows[0])
          : db
              .select({
                version: design.canvasVersion,
                revision: design.revision,
              })
              .from(design)
              .where(
                and(
                  eq(design.id, input.designId),
                  eq(design.userId, access.ownerUserId),
                ),
              )
              .limit(1)
              .then((rows) => rows[0])
    const [target, activity] = await Promise.all([
      targetPromise,
      readCanvasAgentActivity(access.ownerUserId, input),
    ])
    if (!target) throw new ORPCError('NOT_FOUND')
    if (target.version !== CANVAS_SCHEMA_VERSION) {
      return {
        status: 'unsupported' as const,
        version: target.version,
        revision: target.revision,
      }
    }
    if (input.sinceRevision === undefined) {
      const document = 'document' in target ? target.document : null
      if (!document) {
        return {
          status: 'unsupported' as const,
          version: target.version,
          revision: target.revision,
        }
      }
      return {
        status: 'ready' as const,
        version: CANVAS_SCHEMA_VERSION,
        revision: target.revision,
        document: parseCanvasDocument(document),
        transactions: [] as CanvasTransaction[],
        activity,
      }
    }
    if (input.sinceRevision === target.revision) {
      return {
        status: 'ready' as const,
        version: CANVAS_SCHEMA_VERSION,
        revision: target.revision,
        document: null,
        transactions: [] as CanvasTransaction[],
        activity,
      }
    }
    const intervening = await canvasInterveningTransactions(
      access.ownerUserId,
      input.designId,
      input.draftId,
      input.sinceRevision,
      target.revision,
    )
    const complete =
      intervening.length <= 100 &&
      intervening[0]?.revision === input.sinceRevision + 1 &&
      intervening.at(-1)?.revision === target.revision
    const snapshot = complete
      ? null
      : await canvasTargetSnapshot(
          access.ownerUserId,
          input.designId,
          input.draftId,
        )
    if (
      !complete &&
      (!snapshot ||
        snapshot.version !== CANVAS_SCHEMA_VERSION ||
        !snapshot.document)
    ) {
      return {
        status: 'unsupported' as const,
        version: snapshot?.version ?? target.version,
        revision: snapshot?.revision ?? target.revision,
      }
    }
    return {
      status: 'ready' as const,
      version: CANVAS_SCHEMA_VERSION,
      revision: snapshot?.revision ?? target.revision,
      document: snapshot?.document
        ? parseCanvasDocument(snapshot.document)
        : null,
      transactions: complete
        ? intervening.map((entry) => parseCanvasTransaction(entry.transaction))
        : [],
      activity,
    }
  })

const applyCanvasTransactions = consentedProcedure
  .input(
    canvasTargetInput.extend({
      expectedRevision: z.number().int().nonnegative(),
      transactions: z.array(z.unknown()).min(1).max(100),
    }),
  )
  .handler(async ({ context, input }) => {
    // Writes land on the owner's rows, and only an editor may make them.
    const access = await requireDesignAccess(
      context.user,
      input.designId,
      'edit',
    )
    const transactions = input.transactions.map(parseCanvasTransaction)
    if (
      new Set(transactions.map((transaction) => transaction.id)).size !==
      transactions.length
    ) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'A transaction batch cannot contain duplicate ids.',
      })
    }
    const duplicateIds = new Set(
      await db
        .select({ id: canvasTransactionLog.transactionId })
        .from(canvasTransactionLog)
        .where(
          and(
            eq(canvasTransactionLog.userId, access.ownerUserId),
            eq(canvasTransactionLog.designId, input.designId),
            eq(canvasTransactionLog.targetKey, canvasTargetKey(input.draftId)),
            inArray(
              canvasTransactionLog.transactionId,
              transactions.map((transaction) => transaction.id),
            ),
          ),
        )
        .then((rows) => rows.map((row) => row.id)),
    )

    const result = await db.transaction(async (tx) => {
      const target = input.draftId
        ? await tx
            .select({
              version: designDraft.canvasVersion,
              document: designDraft.canvasDocument,
              revision: designDraft.revision,
              status: designDraft.status,
            })
            .from(designDraft)
            .where(
              and(
                eq(designDraft.id, input.draftId),
                eq(designDraft.designId, input.designId),
                eq(designDraft.userId, access.ownerUserId),
              ),
            )
            .limit(1)
            .then((rows) => rows[0])
        : await tx
            .select({
              version: design.canvasVersion,
              document: design.canvasDocument,
              revision: design.revision,
            })
            .from(design)
            .where(and(eq(design.id, input.designId), eq(design.userId, access.ownerUserId)))
            .limit(1)
            .then((rows) => rows[0])
      if (!target) throw new ORPCError('NOT_FOUND')
      if (target.version !== CANVAS_SCHEMA_VERSION || !target.document) {
        throw new ORPCError('CONFLICT', { message: 'UNSUPPORTED_CANVAS' })
      }
      if ('status' in target && target.status !== 'active') {
        throw new ORPCError('CONFLICT', { message: 'This branch is read-only.' })
      }
      const document = parseCanvasDocument(target.document)
      if (transactions.every((transaction) => duplicateIds.has(transaction.id))) {
        return {
          applied: true as const,
          idempotent: true,
          revision: target.revision,
          document,
          transactionIds: transactions.map((transaction) => transaction.id),
          appliedTransactionIds: [] as string[],
          changedNodeIds: [] as string[],
        }
      }
      if (target.revision !== input.expectedRevision) {
        const intervening = await canvasInterveningTransactions(
          access.ownerUserId,
          input.designId,
          input.draftId,
          input.expectedRevision,
          target.revision,
        )
        const complete =
          intervening.length <= 100 &&
          intervening[0]?.revision === input.expectedRevision + 1 &&
          intervening.at(-1)?.revision === target.revision
        return {
          applied: false as const,
          reason: 'stale' as const,
          revision: target.revision,
          document: complete ? null : document,
          transactions: complete
            ? intervening.map((entry) => parseCanvasTransaction(entry.transaction))
            : [],
        }
      }

      const engine = new CanvasEngine(document)
      let nextDocument: CanvasDocument = document
      const freshTransactions = transactions.filter(
        (transaction) => !duplicateIds.has(transaction.id),
      )
      const appliedTransactions: CanvasTransaction[] = []
      const changedNodeIds = new Set<string>()
      try {
        for (const transaction of freshTransactions) {
          const prepared = withTransactionPreconditions(
            engine.document,
            transaction,
          )
          const result = engine.apply(prepared, { recordHistory: false })
          appliedTransactions.push(prepared)
          nextDocument = engine.document
          for (const id of result.changedNodeIds) changedNodeIds.add(id)
        }
      } catch (error) {
        if (error instanceof CanvasConflictError) {
          return {
            applied: false as const,
            reason: 'conflict' as const,
            revision: target.revision,
            conflicts: error.conflicts,
          }
        }
        throw error
      }

      const nextRevision = target.revision + freshTransactions.length
      const updated = input.draftId
        ? await tx
            .update(designDraft)
            .set({
              canvasDocument: nextDocument,
              canvasVersion: CANVAS_SCHEMA_VERSION,
              revision: nextRevision,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(designDraft.id, input.draftId),
                eq(designDraft.designId, input.designId),
                eq(designDraft.userId, access.ownerUserId),
                eq(designDraft.status, 'active'),
                eq(designDraft.revision, target.revision),
              ),
            )
            .returning({ revision: designDraft.revision })
        : await tx
            .update(design)
            .set({
              canvasDocument: nextDocument,
              canvasVersion: CANVAS_SCHEMA_VERSION,
              revision: nextRevision,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(design.id, input.designId),
                eq(design.userId, access.ownerUserId),
                eq(design.revision, target.revision),
              ),
            )
            .returning({ revision: design.revision })
      if (updated.length === 0) {
        const latest = input.draftId
          ? await tx
              .select({
                revision: designDraft.revision,
                document: designDraft.canvasDocument,
              })
              .from(designDraft)
              .where(
                and(
                  eq(designDraft.id, input.draftId),
                  eq(designDraft.designId, input.designId),
                  eq(designDraft.userId, access.ownerUserId),
                ),
              )
              .limit(1)
              .then((rows) => rows[0])
          : await tx
              .select({
                revision: design.revision,
                document: design.canvasDocument,
              })
              .from(design)
              .where(
                and(
                  eq(design.id, input.designId),
                  eq(design.userId, access.ownerUserId),
                ),
              )
              .limit(1)
              .then((rows) => rows[0])
        if (!latest?.document) {
          throw new ORPCError('CONFLICT', { message: 'STALE_REVISION' })
        }
        return {
          applied: false as const,
          reason: 'stale' as const,
          revision: latest.revision,
          document: parseCanvasDocument(latest.document),
          transactions: [] as CanvasTransaction[],
        }
      }
      if (freshTransactions.length > 0) {
        await tx.insert(canvasTransactionLog).values(
          appliedTransactions.map((transaction, index) => ({
            designId: input.designId,
            userId: access.ownerUserId,
            authorUserId: context.user.id,
            targetKey: canvasTargetKey(input.draftId),
            transactionId: transaction.id,
            baseRevision: target.revision + index,
            revision: target.revision + index + 1,
            transaction,
          })),
        )
        const pruneBefore = canvasTransactionPruneBefore(
          target.revision,
          nextRevision,
        )
        if (pruneBefore !== null) {
          await tx
            .delete(canvasTransactionLog)
            .where(
              and(
                eq(canvasTransactionLog.userId, access.ownerUserId),
                eq(canvasTransactionLog.designId, input.designId),
                eq(
                  canvasTransactionLog.targetKey,
                  canvasTargetKey(input.draftId),
                ),
                lt(canvasTransactionLog.revision, pruneBefore),
              ),
            )
        }
      }
      return {
        applied: true as const,
        idempotent: freshTransactions.length === 0,
        revision: nextRevision,
        document: null,
        transactionIds: transactions.map((transaction) => transaction.id),
        appliedTransactionIds: freshTransactions.map(
          (transaction) => transaction.id,
        ),
        changedNodeIds: [...changedNodeIds],
      }
    })
    if (result.applied && !result.idempotent) {
      void publishCanvasRealtimeEvent(access.ownerUserId, input, {
        type: 'canvas.changed',
        revision: result.revision,
        nodeIds: result.changedNodeIds,
      })
    }
    return result
  })

async function getOwnedDraft(userId: string, designId: string, draftId: string) {
  const [draft] = await db
    .select()
    .from(designDraft)
    .where(
      and(
        eq(designDraft.id, draftId),
        eq(designDraft.designId, designId),
        eq(designDraft.userId, userId),
      ),
    )
    .limit(1)
  if (!draft) throw new ORPCError('NOT_FOUND')
  return draft
}

type BranchMergeResolutions = Record<string, 'main' | 'draft'>

function canvasMergeResolutions(
  resolutions: BranchMergeResolutions,
): CanvasMergeResolutions {
  return Object.fromEntries(
    Object.entries(resolutions).map(([id, side]) => [
      id,
      side === 'draft' ? 'right' : 'left',
    ]),
  )
}

function branchMergeConflicts(conflicts: CanvasMergeConflict[]) {
  return conflicts.map(({ left, right, ...conflict }) => ({
    ...conflict,
    main: left,
    draft: right,
  }))
}

async function getDraftComparison(userId: string, designId: string, draftId: string) {
  const [main, draft] = await Promise.all([
    db
      .select({
        shapes: design.shapes,
        pages: design.pages,
        canvasVersion: design.canvasVersion,
        canvasDocument: design.canvasDocument,
        revision: design.revision,
      })
      .from(design)
      .where(and(eq(design.id, designId), eq(design.userId, userId)))
      .limit(1)
      .then((rows) => rows[0]),
    getOwnedDraft(userId, designId, draftId),
  ])
  if (!main) throw new ORPCError('NOT_FOUND')
  const usesCanvasDocument =
    main.canvasVersion === CANVAS_SCHEMA_VERSION &&
    draft.canvasVersion === CANVAS_SCHEMA_VERSION &&
    draft.baseCanvasVersion === CANVAS_SCHEMA_VERSION &&
    !!main.canvasDocument &&
    !!draft.canvasDocument &&
    !!draft.baseCanvasDocument
  const documentMerge = usesCanvasDocument
    ? mergeDocuments(
        parseCanvasDocument(draft.baseCanvasDocument),
        parseCanvasDocument(main.canvasDocument),
        parseCanvasDocument(draft.canvasDocument),
      )
    : null
  const legacyMerge = usesCanvasDocument
    ? null
    : mergeCanvas(
        draft.baseShapes,
        main.shapes,
        draft.shapes,
        {},
        draft.basePages,
        main.pages,
        draft.pages,
      )
  return {
    draft: {
      id: draft.id,
      name: draft.name,
      description: draft.description,
      status: draft.status,
      baseRevision: draft.baseRevision,
      revision: draft.revision,
      proposedAt: draft.proposedAt?.getTime() ?? null,
      appliedAt: draft.appliedAt?.getTime() ?? null,
      closedAt: draft.closedAt?.getTime() ?? null,
    },
    mainRevision: main.revision,
    canvasVersion: usesCanvasDocument ? CANVAS_SCHEMA_VERSION : 1,
    mainDocument: usesCanvasDocument ? parseCanvasDocument(main.canvasDocument) : null,
    draftDocument: usesCanvasDocument ? parseCanvasDocument(draft.canvasDocument) : null,
    baseDocument: usesCanvasDocument ? parseCanvasDocument(draft.baseCanvasDocument) : null,
    mainShapes: main.shapes,
    draftShapes: draft.shapes,
    baseShapes: draft.baseShapes,
    mainPages: main.pages,
    draftPages: draft.pages,
    basePages: draft.basePages,
    summary: documentMerge?.summary ?? legacyMerge!.summary,
    conflicts: documentMerge
      ? branchMergeConflicts(documentMerge.conflicts)
      : legacyMerge!.conflicts,
    unresolved: documentMerge?.unresolved ?? legacyMerge!.unresolved,
  }
}

const listDrafts = protectedProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      includeArchived: z.boolean().default(true),
    }),
  )
  .handler(async ({ context, input }) => {
    const rows = await db
      .select({
        id: designDraft.id,
        name: designDraft.name,
        description: designDraft.description,
        status: designDraft.status,
        baseRevision: designDraft.baseRevision,
        revision: designDraft.revision,
        proposedAt: designDraft.proposedAt,
        appliedAt: designDraft.appliedAt,
        closedAt: designDraft.closedAt,
        createdAt: designDraft.createdAt,
        updatedAt: designDraft.updatedAt,
      })
      .from(designDraft)
      .where(
        and(
          eq(designDraft.designId, input.designId),
          eq(designDraft.userId, context.user.id),
          input.includeArchived
            ? undefined
            : or(eq(designDraft.status, 'active'), eq(designDraft.status, 'proposed')),
        ),
      )
      .orderBy(desc(designDraft.updatedAt))

    return rows.map((row) => ({
      ...row,
      proposedAt: row.proposedAt?.getTime() ?? null,
      appliedAt: row.appliedAt?.getTime() ?? null,
      closedAt: row.closedAt?.getTime() ?? null,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    }))
  })

const createDraft = protectedProcedure
  .input(
    z.object({
      id: draftIdSchema,
      designId: z.string().min(1).max(128),
      name: z.string().trim().min(1).max(200),
      description: z.string().trim().max(2_000).default(''),
      empty: z.boolean().default(false),
    }),
  )
  .handler(async ({ context, input }) => {
    const { empty, ...values } = input
    const [main] = await db
      .select({
        name: design.name,
        shapes: design.shapes,
        pages: design.pages,
        canvasVersion: design.canvasVersion,
        canvasDocument: design.canvasDocument,
        revision: design.revision,
      })
      .from(design)
      .where(and(eq(design.id, input.designId), eq(design.userId, context.user.id)))
      .limit(1)
    if (!main) throw new ORPCError('NOT_FOUND')
    await ensureOpenBranchRoom(context.user, input.designId)
    const mainDocument =
      main.canvasVersion === CANVAS_SCHEMA_VERSION && main.canvasDocument
        ? parseCanvasDocument(main.canvasDocument)
        : null
    const emptyDocument = mainDocument
      ? {
          ...createCanvasDocument(mainDocument.name, mainDocument.id),
          breakpoints: mainDocument.breakpoints,
          metadata: { ...mainDocument.metadata, updatedAt: Date.now() },
        }
      : null

    // An empty branch bases off an empty canvas rather than Main's, so merging
    // it back adds its work instead of reading as "the branch deleted Main".
    const [created] = await db
      .insert(designDraft)
      .values({
        ...values,
        userId: context.user.id,
        baseShapes: empty ? [] : main.shapes,
        shapes: empty ? [] : main.shapes,
        basePages: empty ? [] : main.pages,
        pages: empty ? [] : main.pages,
        canvasVersion: mainDocument ? CANVAS_SCHEMA_VERSION : 1,
        baseCanvasVersion: mainDocument ? CANVAS_SCHEMA_VERSION : 1,
        baseCanvasDocument: mainDocument
          ? empty
            ? emptyDocument
            : mainDocument
          : null,
        canvasDocument: mainDocument
          ? empty
            ? emptyDocument
            : mainDocument
          : null,
        baseRevision: main.revision,
      })
      .returning()

    return {
      ...created,
      proposedAt: null,
      appliedAt: null,
      closedAt: null,
      createdAt: created.createdAt.getTime(),
      updatedAt: created.updatedAt.getTime(),
    }
  })

const getDraft = protectedProcedure
  .input(z.object({ designId: z.string().min(1).max(128), id: draftIdSchema }))
  .handler(async ({ context, input }) => {
    const draft = await getOwnedDraft(context.user.id, input.designId, input.id)
    return {
      ...draft,
      proposedAt: draft.proposedAt?.getTime() ?? null,
      appliedAt: draft.appliedAt?.getTime() ?? null,
      closedAt: draft.closedAt?.getTime() ?? null,
      createdAt: draft.createdAt.getTime(),
      updatedAt: draft.updatedAt.getTime(),
    }
  })

const saveDraft = protectedProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      id: draftIdSchema,
      shapes: z.array(shapeSchema).max(10_000),
      pages: z.array(pageSchema).max(1_000).default([]),
      expectedRevision: z.number().int().nonnegative(),
    }),
  )
  .handler(async ({ context, input }) => {
    const [saved] = await db
      .update(designDraft)
      .set({
        shapes: input.shapes,
        pages: input.pages,
        revision: input.expectedRevision + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(designDraft.id, input.id),
          eq(designDraft.designId, input.designId),
          eq(designDraft.userId, context.user.id),
          eq(designDraft.status, 'active'),
          eq(designDraft.revision, input.expectedRevision),
        ),
      )
      .returning({ revision: designDraft.revision, updatedAt: designDraft.updatedAt })

    if (!saved) {
      const draft = await getOwnedDraft(context.user.id, input.designId, input.id)
      if (draft.status !== 'active') {
        throw new ORPCError('CONFLICT', { message: 'This draft is read-only.' })
      }
      throw new ORPCError('CONFLICT', { message: 'This draft changed since it was loaded.' })
    }
    return { revision: saved.revision, updatedAt: saved.updatedAt.getTime() }
  })

const renameDraft = protectedProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      id: draftIdSchema,
      name: z.string().trim().min(1).max(200),
    }),
  )
  .handler(async ({ context, input }) => {
    const [updated] = await db
      .update(designDraft)
      .set({ name: input.name, updatedAt: new Date() })
      .where(
        and(
          eq(designDraft.id, input.id),
          eq(designDraft.designId, input.designId),
          eq(designDraft.userId, context.user.id),
          eq(designDraft.status, 'active'),
        ),
      )
      .returning({ id: designDraft.id, name: designDraft.name })
    if (!updated) throw new ORPCError('CONFLICT', { message: 'Only active drafts can be renamed.' })
    return updated
  })

const proposeDraft = protectedProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      id: draftIdSchema,
      description: z.string().trim().max(2_000).default(''),
    }),
  )
  .handler(async ({ context, input }) => {
    const now = new Date()
    const [updated] = await db
      .update(designDraft)
      .set({
        status: 'proposed',
        description: input.description,
        proposedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(designDraft.id, input.id),
          eq(designDraft.designId, input.designId),
          eq(designDraft.userId, context.user.id),
          eq(designDraft.status, 'active'),
        ),
      )
      .returning({ id: designDraft.id, status: designDraft.status, proposedAt: designDraft.proposedAt })
    if (!updated) throw new ORPCError('CONFLICT', { message: 'Only active drafts can be proposed.' })
    return { ...updated, proposedAt: updated.proposedAt?.getTime() ?? null }
  })

const reopenDraft = protectedProcedure
  .input(z.object({ designId: z.string().min(1).max(128), id: draftIdSchema }))
  .handler(async ({ context, input }) => {
    // A discarded draft is recoverable; an applied one is not — reopening
    // that would resurrect work already merged into Main.
    const existing = await getOwnedDraft(context.user.id, input.designId, input.id)
    if (existing.status !== 'proposed' && existing.status !== 'closed') {
      throw new ORPCError('CONFLICT', {
        message: 'Only proposed or discarded drafts can be reopened.',
      })
    }
    // Closed → open increases the open-branch count; proposed → active does not.
    if (existing.status === 'closed') {
      await ensureOpenBranchRoom(context.user, input.designId)
    }
    const [updated] = await db
      .update(designDraft)
      .set({ status: 'active', proposedAt: null, closedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(designDraft.id, input.id),
          eq(designDraft.designId, input.designId),
          eq(designDraft.userId, context.user.id),
          or(eq(designDraft.status, 'proposed'), eq(designDraft.status, 'closed')),
        ),
      )
      .returning({ id: designDraft.id, status: designDraft.status })
    if (!updated) {
      throw new ORPCError('CONFLICT', {
        message: 'Only proposed or discarded drafts can be reopened.',
      })
    }
    return updated
  })

const closeDraft = protectedProcedure
  .input(z.object({ designId: z.string().min(1).max(128), id: draftIdSchema }))
  .handler(async ({ context, input }) => {
    const now = new Date()
    const [updated] = await db
      .update(designDraft)
      .set({ status: 'closed', closedAt: now, updatedAt: now })
      .where(
        and(
          eq(designDraft.id, input.id),
          eq(designDraft.designId, input.designId),
          eq(designDraft.userId, context.user.id),
          or(eq(designDraft.status, 'active'), eq(designDraft.status, 'proposed')),
        ),
      )
      .returning({ id: designDraft.id, status: designDraft.status, closedAt: designDraft.closedAt })
    if (!updated) throw new ORPCError('CONFLICT', { message: 'This draft is already archived.' })
    return { ...updated, closedAt: updated.closedAt?.getTime() ?? null }
  })

const compareDraft = protectedProcedure
  .input(z.object({ designId: z.string().min(1).max(128), id: draftIdSchema }))
  .handler(({ context, input }) => getDraftComparison(context.user.id, input.designId, input.id))

const applyDraft = protectedProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      id: draftIdSchema,
      expectedMainRevision: z.number().int().nonnegative(),
      expectedDraftRevision: z.number().int().nonnegative(),
      resolutions: z.record(z.string(), z.enum(['main', 'draft'])).default({}),
    }),
  )
  .handler(async ({ context, input }) => {
    const comparison = await getDraftComparison(context.user.id, input.designId, input.id)
    if (
      comparison.mainRevision !== input.expectedMainRevision ||
      comparison.draft.revision !== input.expectedDraftRevision
    ) {
      throw new ORPCError('CONFLICT', { message: 'Main or the draft changed during review.' })
    }
    if (comparison.draft.status !== 'active' && comparison.draft.status !== 'proposed') {
      throw new ORPCError('CONFLICT', { message: 'This draft is already archived.' })
    }

    const documentMerge =
      comparison.canvasVersion === CANVAS_SCHEMA_VERSION &&
      comparison.baseDocument &&
      comparison.mainDocument &&
      comparison.draftDocument
        ? mergeDocuments(
            comparison.baseDocument,
            comparison.mainDocument,
            comparison.draftDocument,
            canvasMergeResolutions(input.resolutions),
          )
        : null
    const legacyMerge = documentMerge
      ? null
      : mergeCanvas(
          comparison.baseShapes,
          comparison.mainShapes,
          comparison.draftShapes,
          input.resolutions as Record<string, MergeChoice>,
          comparison.basePages,
          comparison.mainPages,
          comparison.draftPages,
        )
    const unresolved = documentMerge?.unresolved ?? legacyMerge!.unresolved
    const conflicts = documentMerge
      ? branchMergeConflicts(documentMerge.conflicts)
      : legacyMerge!.conflicts
    if (unresolved.length > 0) {
      return {
        applied: false as const,
        unresolved,
        conflicts,
      }
    }

    const beforeId = `v${crypto.randomUUID().replaceAll('-', '')}`
    const appliedId = `v${crypto.randomUUID().replaceAll('-', '')}`
    const now = new Date()
    await db.transaction(async (tx) => {
      const [updatedMain] = await tx
        .update(design)
        .set({
          shapes: legacyMerge?.shapes ?? comparison.mainShapes,
          pages: legacyMerge?.pages ?? comparison.mainPages,
          canvasVersion: documentMerge ? CANVAS_SCHEMA_VERSION : comparison.canvasVersion,
          canvasDocument: documentMerge?.document ?? comparison.mainDocument,
          revision: input.expectedMainRevision + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(design.id, input.designId),
            eq(design.userId, context.user.id),
            eq(design.revision, input.expectedMainRevision),
          ),
        )
        .returning({ id: design.id })
      if (!updatedMain) {
        throw new ORPCError('CONFLICT', { message: 'Main changed while applying the draft.' })
      }

      await tx.insert(designVersion).values([
        {
          id: beforeId,
          designId: input.designId,
          userId: context.user.id,
          message: `Before applying: ${comparison.draft.name}`,
          shapes: comparison.mainShapes,
          pages: comparison.mainPages,
          canvasVersion: comparison.canvasVersion,
          canvasDocument: comparison.mainDocument,
          ...(documentMerge
            ? diffDocuments(
                createCanvasDocument(
                  comparison.mainDocument?.name,
                  comparison.mainDocument?.id,
                ),
                comparison.mainDocument!,
              )
            : documentDiff([], comparison.mainShapes, [], comparison.mainPages)),
        },
        {
          id: appliedId,
          designId: input.designId,
          userId: context.user.id,
          message: `Applied draft: ${comparison.draft.name}`,
          shapes: legacyMerge?.shapes ?? comparison.mainShapes,
          pages: legacyMerge?.pages ?? comparison.mainPages,
          canvasVersion: documentMerge ? CANVAS_SCHEMA_VERSION : comparison.canvasVersion,
          canvasDocument: documentMerge?.document ?? comparison.mainDocument,
          ...(documentMerge
            ? diffDocuments(comparison.mainDocument!, documentMerge.document)
            : documentDiff(
                comparison.mainShapes,
                legacyMerge!.shapes,
                comparison.mainPages,
                legacyMerge!.pages,
              )),
        },
      ])

      const [updatedDraft] = await tx
        .update(designDraft)
        .set({
          status: 'applied',
          appliedAt: now,
          appliedVersionId: appliedId,
          updatedAt: now,
        })
        .where(
          and(
            eq(designDraft.id, input.id),
            eq(designDraft.designId, input.designId),
            eq(designDraft.userId, context.user.id),
            eq(designDraft.revision, input.expectedDraftRevision),
            or(eq(designDraft.status, 'active'), eq(designDraft.status, 'proposed')),
          ),
        )
        .returning({ id: designDraft.id })
      if (!updatedDraft) {
        throw new ORPCError('CONFLICT', { message: 'The draft changed while it was applying.' })
      }

    })

    scheduleHistoryPrune(context.user)
    return {
      applied: true as const,
      revision: input.expectedMainRevision + 1,
      versionId: appliedId,
      canvasVersion: documentMerge ? CANVAS_SCHEMA_VERSION : comparison.canvasVersion,
      document: documentMerge?.document ?? null,
      shapes: legacyMerge?.shapes ?? comparison.mainShapes,
      pages: legacyMerge?.pages ?? comparison.mainPages,
      unresolved: [] as string[],
    }
  })

const createDesignHandoff = protectedProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      draftId: optionalDraftIdSchema,
    }),
  )
  .handler(async ({ context, input }) => {
    const [found] = await db
      .select({ id: design.id })
      .from(design)
      .where(and(eq(design.id, input.designId), eq(design.userId, context.user.id)))
      .limit(1)
    if (!found) throw new ORPCError('NOT_FOUND')
    if (input.draftId) {
      await getOwnedDraft(context.user.id, input.designId, input.draftId)
    }
    return createHandoffToken(input.designId, context.user.id, undefined, input.draftId)
  })

const listVersions = protectedProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      draftId: optionalDraftIdSchema,
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
    // Soft-filter only on list — hard prune runs on commits, never on reads,
    // so a mis-resolved Free plan cannot destroy Pro history while browsing.
    const { capacity } = await resolveHistoryCapacity(context.user)
    const cutoff = historyCutoffForCapacity(capacity)
    const cursorDate = input.cursor ? new Date(input.cursor.at) : null
    const versions = await db
      .select({
        id: designVersion.id,
        message: designVersion.message,
        canvasVersion: designVersion.canvasVersion,
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
          draftTargetWhere(input.draftId),
          cutoff ? gte(designVersion.createdAt, cutoff) : undefined,
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
      draftId: optionalDraftIdSchema,
      id: z.string().min(1).max(128),
    }),
  )
  .handler(async ({ context, input }) => {
    const [current] = await db
      .select({
        id: designVersion.id,
        message: designVersion.message,
        shapes: designVersion.shapes,
        pages: designVersion.pages,
        createdAt: designVersion.createdAt,
      })
      .from(designVersion)
      .where(
        and(
          eq(designVersion.id, input.id),
          eq(designVersion.designId, input.designId),
          eq(designVersion.userId, context.user.id),
          draftTargetWhere(input.draftId),
        ),
      )
      .limit(1)

    if (!current) throw new ORPCError('NOT_FOUND')
    await ensureHistoryVersionAccessible(context.user, current.createdAt)
    const { capacity } = await resolveHistoryCapacity(context.user)
    const cutoff = historyCutoffForCapacity(capacity)
    const [previous] = await db
      .select({
        id: designVersion.id,
        message: designVersion.message,
        shapes: designVersion.shapes,
        pages: designVersion.pages,
        createdAt: designVersion.createdAt,
      })
      .from(designVersion)
      .where(
        and(
          eq(designVersion.designId, input.designId),
          eq(designVersion.userId, context.user.id),
          draftTargetWhere(input.draftId),
          cutoff ? gte(designVersion.createdAt, cutoff) : undefined,
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
      pages: version.pages,
      at: version.createdAt.getTime(),
    })
    return { current: detail(current), previous: previous ? detail(previous) : null }
  })

const importVersions = protectedProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      draftId: optionalDraftIdSchema,
      commits: z
        .array(
          z.object({
            id: z.string().min(1).max(128),
            message: z.string().trim().min(1).max(200),
            at: z.number().int().min(0).max(8_640_000_000_000_000),
            shapes: z.array(shapeSchema).max(10_000),
            pages: z.array(pageSchema).max(1_000).default([]),
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
    await ensureDesign(input.designId, context.user)
    if (input.draftId) {
      const draft = await getOwnedDraft(context.user.id, input.designId, input.draftId)
      if (draft.status !== 'active') {
        throw new ORPCError('CONFLICT', { message: 'This draft is read-only.' })
      }
    }
    const { capacity } = await resolveHistoryCapacity(context.user)
    const cutoff = historyCutoffForCapacity(capacity)
    // Sequential inside one transaction: the bun-sql driver has no batch(), and a
    // single connection can't run these in parallel anyway.
    let processed = 0
    await db.transaction(async (tx) => {
      for (const commit of sortCommitsOldestFirst(input.commits)) {
        // Skip versions that already fall outside the plan retention window.
        if (cutoff && commit.at < cutoff.getTime()) continue
        const { at, ...values } = commit
        await tx
          .insert(designVersion)
          .values({
            ...values,
            designId: input.designId,
            draftId: input.draftId ?? null,
            userId: context.user.id,
            createdAt: new Date(at),
          })
          .onConflictDoNothing({ target: [designVersion.id, designVersion.userId] })
        processed += 1
      }
    })
    scheduleHistoryPrune(context.user)
    return { processed }
  })

const commitVersion = protectedProcedure
  .input(
    z.object({
      id: z.string().min(1).max(128),
      designId: z.string().min(1).max(128),
      draftId: optionalDraftIdSchema,
      message: z.string().trim().min(1).max(200),
      shapes: z.array(shapeSchema).max(10_000),
      pages: z.array(pageSchema).max(1_000).default([]),
      skipIfUnchanged: z.boolean().optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    if (input.draftId) {
      const draft = await getOwnedDraft(context.user.id, input.designId, input.draftId)
      if (draft.status !== 'active') {
        throw new ORPCError('CONFLICT', { message: 'This draft is read-only.' })
      }
    }
    const [latest] = await db
      .select({ shapes: designVersion.shapes, pages: designVersion.pages })
      .from(designVersion)
      .where(
        and(
          eq(designVersion.designId, input.designId),
          eq(designVersion.userId, context.user.id),
          draftTargetWhere(input.draftId),
        ),
      )
      .orderBy(desc(designVersion.createdAt), desc(designVersion.id))
      .limit(1)

    if (
      input.skipIfUnchanged &&
      (input.shapes.length === 0 && input.pages.length === 0 ||
        (JSON.stringify(latest?.shapes) === JSON.stringify(input.shapes) &&
          JSON.stringify(latest?.pages) === JSON.stringify(input.pages)))
    ) {
      return null
    }

    const changes = documentDiff(
      latest?.shapes ?? [],
      input.shapes,
      latest?.pages ?? [],
      input.pages,
    )
    await ensureDesign(input.designId, context.user)
    const [version] = await db
      .insert(designVersion)
      .values({
        id: input.id,
        designId: input.designId,
        draftId: input.draftId ?? null,
        userId: context.user.id,
        message: input.message,
        shapes: input.shapes,
        pages: input.pages,
        ...changes,
      })
      .returning()

    scheduleHistoryPrune(context.user)
    return {
      id: version.id,
      message: version.message,
      added: version.added,
      removed: version.removed,
      changed: version.changed,
      at: version.createdAt.getTime(),
    }
  })

const commitCanvasVersion = protectedProcedure
  .input(
    canvasTargetInput.extend({
      id: z.string().min(1).max(128),
      message: z.string().trim().min(1).max(200),
      document: z.unknown(),
      skipIfUnchanged: z.boolean().default(true),
    }),
  )
  .handler(async ({ context, input }) => {
    const document = parseCanvasDocument(input.document)
    if (input.draftId) {
      const draft = await getOwnedDraft(
        context.user.id,
        input.designId,
        input.draftId,
      )
      if (draft.status !== 'active') {
        throw new ORPCError('CONFLICT', { message: 'This branch is read-only.' })
      }
    } else {
      await ensureDesign(input.designId, context.user)
    }
    const [latest] = await db
      .select({
        canvasVersion: designVersion.canvasVersion,
        document: designVersion.canvasDocument,
      })
      .from(designVersion)
      .where(
        and(
          eq(designVersion.designId, input.designId),
          eq(designVersion.userId, context.user.id),
          draftTargetWhere(input.draftId),
        ),
      )
      .orderBy(desc(designVersion.createdAt), desc(designVersion.id))
      .limit(1)
    const previous =
      latest?.canvasVersion === CANVAS_SCHEMA_VERSION && latest.document
        ? parseCanvasDocument(latest.document)
        : createCanvasDocument(document.name, document.id)
    if (
      input.skipIfUnchanged &&
      JSON.stringify(previous) === JSON.stringify(document)
    ) {
      return null
    }
    const changes = diffDocuments(previous, document)
    const [version] = await db
      .insert(designVersion)
      .values({
        id: input.id,
        designId: input.designId,
        draftId: input.draftId ?? null,
        userId: context.user.id,
        message: input.message,
        shapes: [],
        pages: [],
        canvasVersion: CANVAS_SCHEMA_VERSION,
        canvasDocument: document,
        ...changes,
      })
      .returning()
    scheduleHistoryPrune(context.user)
    return {
      id: version.id,
      message: version.message,
      added: version.added,
      removed: version.removed,
      changed: version.changed,
      at: version.createdAt.getTime(),
    }
  })

const compareCanvasVersion = protectedProcedure
  .input(
    canvasTargetInput.extend({
      id: z.string().min(1).max(128),
    }),
  )
  .handler(async ({ context, input }) => {
    const [current] = await db
      .select({
        id: designVersion.id,
        message: designVersion.message,
        canvasVersion: designVersion.canvasVersion,
        document: designVersion.canvasDocument,
        createdAt: designVersion.createdAt,
      })
      .from(designVersion)
      .where(
        and(
          eq(designVersion.id, input.id),
          eq(designVersion.designId, input.designId),
          eq(designVersion.userId, context.user.id),
          draftTargetWhere(input.draftId),
        ),
      )
      .limit(1)
    if (
      !current ||
      current.canvasVersion !== CANVAS_SCHEMA_VERSION ||
      !current.document
    ) {
      throw new ORPCError('NOT_FOUND')
    }
    await ensureHistoryVersionAccessible(context.user, current.createdAt)
    const { capacity } = await resolveHistoryCapacity(context.user)
    const cutoff = historyCutoffForCapacity(capacity)
    const [previous] = await db
      .select({
        id: designVersion.id,
        message: designVersion.message,
        canvasVersion: designVersion.canvasVersion,
        document: designVersion.canvasDocument,
        createdAt: designVersion.createdAt,
      })
      .from(designVersion)
      .where(
        and(
          eq(designVersion.designId, input.designId),
          eq(designVersion.userId, context.user.id),
          draftTargetWhere(input.draftId),
          cutoff ? gte(designVersion.createdAt, cutoff) : undefined,
          or(
            lt(designVersion.createdAt, current.createdAt),
            and(
              eq(designVersion.createdAt, current.createdAt),
              lt(designVersion.id, current.id),
            ),
          ),
          eq(designVersion.canvasVersion, CANVAS_SCHEMA_VERSION),
          isNotNull(designVersion.canvasDocument),
        ),
      )
      .orderBy(desc(designVersion.createdAt), desc(designVersion.id))
      .limit(1)
    const detail = (version: typeof current) => ({
      id: version.id,
      message: version.message,
      document: parseCanvasDocument(version.document),
      at: version.createdAt.getTime(),
    })
    return {
      current: detail(current),
      previous:
        previous?.document && previous.canvasVersion === CANVAS_SCHEMA_VERSION
          ? detail(previous as typeof current)
          : null,
    }
  })

const restoreCanvasVersion = protectedProcedure
  .input(
    canvasTargetInput.extend({
      id: z.string().min(1).max(128),
      expectedRevision: z.number().int().nonnegative(),
    }),
  )
  .handler(async ({ context, input }) => {
    const [version] = await db
      .select({
        canvasVersion: designVersion.canvasVersion,
        document: designVersion.canvasDocument,
        createdAt: designVersion.createdAt,
      })
      .from(designVersion)
      .where(
        and(
          eq(designVersion.id, input.id),
          eq(designVersion.designId, input.designId),
          eq(designVersion.userId, context.user.id),
          draftTargetWhere(input.draftId),
        ),
      )
      .limit(1)
    if (
      !version ||
      version.canvasVersion !== CANVAS_SCHEMA_VERSION ||
      !version.document
    ) {
      throw new ORPCError('NOT_FOUND')
    }
    await ensureHistoryVersionAccessible(context.user, version.createdAt)
    const document = parseCanvasDocument(version.document)
    const updated = input.draftId
      ? await db
          .update(designDraft)
          .set({
            canvasVersion: CANVAS_SCHEMA_VERSION,
            canvasDocument: document,
            revision: input.expectedRevision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(designDraft.id, input.draftId),
              eq(designDraft.designId, input.designId),
              eq(designDraft.userId, context.user.id),
              eq(designDraft.status, 'active'),
              eq(designDraft.revision, input.expectedRevision),
            ),
          )
          .returning({ revision: designDraft.revision })
      : await db
          .update(design)
          .set({
            canvasVersion: CANVAS_SCHEMA_VERSION,
            canvasDocument: document,
            revision: input.expectedRevision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(design.id, input.designId),
              eq(design.userId, context.user.id),
              eq(design.revision, input.expectedRevision),
            ),
          )
          .returning({ revision: design.revision })
    if (!updated[0]) {
      throw new ORPCError('CONFLICT', {
        message: 'The canvas changed before the version could be restored.',
      })
    }
    return {
      revision: updated[0].revision,
      document,
    }
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
    // Plan storage (Free 1 GB / Pro 100 GB) before writing to S3 so a rejected
    // upload never leaves an orphan object.
    await ensureStorageRoom(context.user, bytes.length)
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

const listMcpSessions = consentedProcedure.handler(async ({ context }) => {
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

const revokeMcpSession = consentedProcedure
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

const getLegalConsent = signedInProcedure.handler(async ({ context }) => {
  const [account] = await db
    .select({
      acceptedTerms: user.acceptedTerms,
      acceptedPrivacy: user.acceptedPrivacy,
      termsAcceptedAt: user.termsAcceptedAt,
      privacyAcceptedAt: user.privacyAcceptedAt,
      termsVersion: user.termsVersion,
      privacyVersion: user.privacyVersion,
    })
    .from(user)
    .where(eq(user.id, context.user.id))
    .limit(1)

  if (!account) throw new ORPCError('UNAUTHORIZED')
  return {
    accepted: hasAcceptedCurrentLegal(account),
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION,
  }
})

const acceptLegal = signedInProcedure
  .input(
    z.object({
      acceptedTerms: z.literal(true),
      acceptedPrivacy: z.literal(true),
    }),
  )
  .handler(async ({ context }) => {
    const acceptedAt = new Date()
    const [account] = await db
      .update(user)
      .set({
        acceptedTerms: true,
        acceptedPrivacy: true,
        termsAcceptedAt: acceptedAt,
        privacyAcceptedAt: acceptedAt,
        termsVersion: CURRENT_TERMS_VERSION,
        privacyVersion: CURRENT_PRIVACY_VERSION,
        updatedAt: acceptedAt,
      })
      .where(eq(user.id, context.user.id))
      .returning({ id: user.id })

    if (!account) throw new ORPCError('UNAUTHORIZED')
    return {
      accepted: true,
      termsVersion: CURRENT_TERMS_VERSION,
      privacyVersion: CURRENT_PRIVACY_VERSION,
    }
  })

const getPreviewAccess = consentedProcedure.handler(async ({ context }) => {
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

const requestPreviewAccess = consentedProcedure.handler(async ({ context }) => {
  if (!isPreviewAccessRequired() || canUseApp(context.user)) {
    return { requested: false, granted: true }
  }

  await db
    .update(user)
    .set({ previewAccessRequestedAt: new Date(), updatedAt: new Date() })
    .where(eq(user.id, context.user.id))

  return { requested: true, granted: false }
})

async function deleteUserAccountData(userId: string) {
  // S3 objects don't cascade with the user row; collect and delete them first.
  if (s3) {
    const keys = await db
      .select({ storageKey: asset.storageKey })
      .from(asset)
      .where(and(eq(asset.userId, userId), isNotNull(asset.storageKey)))
    for (const { storageKey } of keys) {
      if (storageKey) {
        await s3
          .delete(storageKey)
          .catch((error) => console.error('[account] S3 delete failed:', error))
      }
    }
  }

  // Everything else (designs, drafts, sessions, oauth tokens) cascades.
  await db.delete(user).where(eq(user.id, userId))
}

const deleteAccount = consentedProcedure.handler(async ({ context }) => {
  await deleteUserAccountData(context.user.id)
  return { deleted: true }
})

const getCurrentBilling = previewProcedure.handler(({ context }) =>
  getBillingStatus(context.user),
)

const refreshCurrentBilling = previewProcedure.handler(({ context }) =>
  refreshBillingStatus(context.user),
)

const createSubscriptionCheckout = previewProcedure
  .input(
    z.object({
      plan: z.enum(['free', 'pro']),
      /** Billing cycle for Pro. Ignored for Free. */
      interval: z.enum(['month', 'year']).default('month'),
    }),
  )
  .handler(async ({ context, input }) => {
    const billing = await authorizeBilling(context.user)
    if (billing.access) {
      const current = billing.entitlement?.plan
      // Free → Pro upgrade is allowed (monthly or yearly). Paid plans manage
      // changes in the Polar customer portal.
      const upgradingFreeToPro = input.plan === 'pro' && current === 'free'
      if (!upgradingFreeToPro) {
        throw new ORPCError('FORBIDDEN', {
          message: 'Manage your existing subscription from Billing.',
        })
      }
    }
    return createPlanCheckout(
      context.user,
      input.plan,
      input.plan === 'pro' ? input.interval : 'month',
    )
  })

const getCurrentMcpUsage = previewProcedure.handler(async ({ context }) => {
  // Same refresh path as billing.status so plan labels and weekly included
  // limits stay aligned when both load in parallel on the billing page.
  const status = await getBillingStatus(context.user)
  const plan = resolveMcpUsagePlan({
    source: status.source,
    access: status.access,
    plan: status.plan,
  })
  if (!plan) return { usage: null }
  try {
    return { usage: await getMcpUsage(context.user.id, plan) }
  } catch (error) {
    if (error instanceof McpUsageUnavailableError) {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: 'MCP usage is temporarily unavailable.',
      })
    }
    throw error
  }
})

const DAY_MS = 24 * 60 * 60 * 1000

function toCount(value: unknown) {
  const n = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
}

/** Escape LIKE wildcards so a search for `%` matches a literal percent sign. */
function likeTerm(search: string) {
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

const adminOverview = adminProcedure.handler(async () => {
  const now = new Date()
  const last7Days = new Date(now.getTime() - 7 * DAY_MS)
  const last24Hours = new Date(now.getTime() - DAY_MS)

  const [
    [users],
    [newUsers],
    [designs],
    [newDesigns],
    [openBranches],
    [assets],
    [publishLinks],
    [activeSessions],
    [mcpClients],
    [versions],
  ] = await Promise.all([
    db
      .select({
        total: count(),
        admins: sum(sql<number>`case when ${user.isAdmin} then 1 else 0 end`),
        previewGranted: sum(
          sql<number>`case when ${user.previewAccess} then 1 else 0 end`,
        ),
        pending: sum(
          sql<number>`case when ${user.previewAccessRequestedAt} is not null
            and not ${user.previewAccess} then 1 else 0 end`,
        ),
      })
      .from(user),
    db.select({ n: count() }).from(user).where(gte(user.createdAt, last7Days)),
    db.select({ n: count() }).from(design),
    db
      .select({ n: count() })
      .from(design)
      .where(gte(design.createdAt, last7Days)),
    db
      .select({ n: count() })
      .from(designDraft)
      .where(
        or(eq(designDraft.status, 'active'), eq(designDraft.status, 'proposed')),
      ),
    db.select({ n: count(), bytes: sum(asset.size) }).from(asset),
    db
      .select({ n: count() })
      .from(publishLink)
      .where(gt(publishLink.expiresAt, now)),
    db
      .select({ n: countDistinct(authSession.userId) })
      .from(authSession)
      .where(
        and(
          gt(authSession.expiresAt, now),
          gte(authSession.updatedAt, last24Hours),
        ),
      ),
    db
      .select({
        clients: countDistinct(oauthAccessToken.clientId),
        users: countDistinct(oauthAccessToken.userId),
      })
      .from(oauthAccessToken)
      .where(isNotNull(oauthAccessToken.clientId)),
    db
      .select({ n: count() })
      .from(designVersion)
      .where(gte(designVersion.createdAt, last7Days)),
  ])

  return {
    generatedAt: now.toISOString(),
    users: {
      total: toCount(users?.total),
      newLast7Days: toCount(newUsers?.n),
      admins: toCount(users?.admins),
      previewGranted: toCount(users?.previewGranted),
      pendingPreviewRequests: toCount(users?.pending),
      activeLast24Hours: toCount(activeSessions?.n),
    },
    designs: {
      total: toCount(designs?.n),
      newLast7Days: toCount(newDesigns?.n),
      openBranches: toCount(openBranches?.n),
      livePublishLinks: toCount(publishLinks?.n),
      versionsLast7Days: toCount(versions?.n),
    },
    storage: {
      assets: toCount(assets?.n),
      bytes: toCount(assets?.bytes),
    },
    mcp: {
      connectedClients: toCount(mcpClients?.clients),
      connectedUsers: toCount(mcpClients?.users),
    },
  }
})

const ADMIN_USER_FILTERS = ['all', 'pending', 'admins', 'paid'] as const

/**
 * One row per account with the usage the other admin actions act on. The
 * aggregates are grouped queries merged in memory rather than correlated
 * subqueries per row: the account table is small, and this keeps the shape
 * readable while staying a fixed number of round-trips.
 */
const listUsersWithUsage = adminProcedure
  .input(
    z
      .object({
        search: z.string().trim().max(320).optional(),
        filter: z.enum(ADMIN_USER_FILTERS).default('all'),
        limit: z.number().int().min(1).max(500).default(200),
      })
      .default({ filter: 'all', limit: 200 }),
  )
  .handler(async ({ input }) => {
    const search = input.search?.trim()
    const conditions = [
      search
        ? or(
            ilike(user.email, likeTerm(search)),
            ilike(user.name, likeTerm(search)),
          )
        : undefined,
      input.filter === 'admins' ? eq(user.isAdmin, true) : undefined,
      input.filter === 'pending'
        ? and(
            isNotNull(user.previewAccessRequestedAt),
            eq(user.previewAccess, false),
          )
        : undefined,
    ].filter(Boolean)

    const rows = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
        previewAccess: user.previewAccess,
        previewAccessRequestedAt: user.previewAccessRequestedAt,
        createdAt: user.createdAt,
      })
      .from(user)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(user.email))
      .limit(input.limit)

    const ids = rows.map((row) => row.id)
    if (ids.length === 0) return []

    const [designRows, assetRows, branchRows, sessionRows, entitlementRows, mcpRows] =
      await Promise.all([
        db
          .select({
            userId: design.userId,
            designs: count(),
            lastDesignAt: max(design.updatedAt),
          })
          .from(design)
          .where(inArray(design.userId, ids))
          .groupBy(design.userId),
        db
          .select({ userId: asset.userId, assets: count(), bytes: sum(asset.size) })
          .from(asset)
          .where(inArray(asset.userId, ids))
          .groupBy(asset.userId),
        db
          .select({ userId: designDraft.userId, openBranches: count() })
          .from(designDraft)
          .where(
            and(
              inArray(designDraft.userId, ids),
              or(
                eq(designDraft.status, 'active'),
                eq(designDraft.status, 'proposed'),
              ),
            ),
          )
          .groupBy(designDraft.userId),
        db
          .select({ userId: authSession.userId, lastSeenAt: max(authSession.updatedAt) })
          .from(authSession)
          .where(inArray(authSession.userId, ids))
          .groupBy(authSession.userId),
        db
          .select({
            userId: billingEntitlement.userId,
            plan: billingEntitlement.plan,
            subscriptionStatus: billingEntitlement.subscriptionStatus,
            accessGranted: billingEntitlement.accessGranted,
            cancelAtPeriodEnd: billingEntitlement.cancelAtPeriodEnd,
            currentPeriodEnd: billingEntitlement.currentPeriodEnd,
          })
          .from(billingEntitlement)
          .where(inArray(billingEntitlement.userId, ids)),
        db
          .select({
            userId: oauthAccessToken.userId,
            clients: countDistinct(oauthAccessToken.clientId),
          })
          .from(oauthAccessToken)
          .where(
            and(
              inArray(oauthAccessToken.userId, ids),
              isNotNull(oauthAccessToken.clientId),
            ),
          )
          .groupBy(oauthAccessToken.userId),
      ])

    const byUser = <T extends { userId: string }>(list: T[]) =>
      new Map(list.map((row) => [row.userId, row]))
    const designsBy = byUser(designRows)
    const assetsBy = byUser(assetRows)
    const branchesBy = byUser(branchRows)
    const sessionsBy = byUser(sessionRows)
    const entitlementsBy = byUser(entitlementRows)
    // `oauth_access_token.user_id` is nullable (client-credentials grants).
    const mcpBy = new Map(
      mcpRows.flatMap((row) => (row.userId ? [[row.userId, row.clients] as const] : [])),
    )

    const users = rows.map((row) => {
      const entitlement = entitlementsBy.get(row.id) ?? null
      return {
        ...row,
        designs: toCount(designsBy.get(row.id)?.designs),
        lastDesignAt: designsBy.get(row.id)?.lastDesignAt ?? null,
        assets: toCount(assetsBy.get(row.id)?.assets),
        storageBytes: toCount(assetsBy.get(row.id)?.bytes),
        openBranches: toCount(branchesBy.get(row.id)?.openBranches),
        lastSeenAt: sessionsBy.get(row.id)?.lastSeenAt ?? null,
        mcpClients: toCount(mcpBy.get(row.id)),
        plan: row.isAdmin ? 'admin' : (entitlement?.plan ?? null),
        subscriptionStatus: entitlement?.subscriptionStatus ?? null,
        billingAccess: row.isAdmin || (entitlement?.accessGranted ?? false),
        cancelAtPeriodEnd: entitlement?.cancelAtPeriodEnd ?? false,
        currentPeriodEnd: entitlement?.currentPeriodEnd ?? null,
      }
    })

    // `paid` needs the joined entitlement, so it filters after the merge.
    return input.filter === 'paid'
      ? users.filter((row) => row.plan === 'pro' || row.plan === 'studio')
      : users
  })

async function requireOtherUser(selfId: string, userId: string, action: string) {
  if (userId === selfId) {
    throw new ORPCError('FORBIDDEN', { message: `You cannot ${action} your own account.` })
  }
  const [target] = await db
    .select({ id: user.id, email: user.email, isAdmin: user.isAdmin })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!target) throw new ORPCError('NOT_FOUND')
  return target
}

const setUserAdmin = adminProcedure
  .input(
    z.object({
      userId: z.string().min(1).max(128),
      isAdmin: z.boolean(),
    }),
  )
  .handler(async ({ context, input }) => {
    await requireOtherUser(context.user.id, input.userId, 'change admin access on')
    const [updated] = await db
      .update(user)
      .set({
        isAdmin: input.isAdmin,
        // An admin bypasses the preview gate anyway; granting it too keeps the
        // account usable after admin is later revoked.
        previewAccess: input.isAdmin ? true : undefined,
        previewAccessRequestedAt: input.isAdmin ? null : undefined,
        updatedAt: new Date(),
      })
      .where(eq(user.id, input.userId))
      .returning({
        userId: user.id,
        isAdmin: user.isAdmin,
        previewAccess: user.previewAccess,
      })
    if (!updated) throw new ORPCError('NOT_FOUND')
    return updated
  })

const approvePendingPreviewAccess = adminProcedure.handler(async () => {
  const granted = await db
    .update(user)
    .set({ previewAccess: true, previewAccessRequestedAt: null, updatedAt: new Date() })
    .where(
      and(isNotNull(user.previewAccessRequestedAt), eq(user.previewAccess, false)),
    )
    .returning({ userId: user.id })
  return { granted: granted.length }
})

const refreshUserBilling = adminProcedure
  .input(z.object({ userId: z.string().min(1).max(128) }))
  .handler(async ({ input }) => {
    const [target] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, input.userId))
      .limit(1)
    if (!target) throw new ORPCError('NOT_FOUND')

    let entitlement: Awaited<ReturnType<typeof refreshEntitlement>> = null
    try {
      entitlement = await refreshEntitlement(input.userId)
    } catch (error) {
      throw new ORPCError('BAD_GATEWAY', {
        message:
          error instanceof Error && error.message
            ? `Polar refresh failed: ${error.message}`
            : 'Polar refresh failed.',
      })
    }
    return {
      plan: entitlement?.plan ?? null,
      subscriptionStatus: entitlement?.subscriptionStatus ?? null,
      accessGranted: entitlement?.accessGranted ?? false,
      currentPeriodEnd: entitlement?.currentPeriodEnd ?? null,
    }
  })

/** Sign an account out of every browser session. Their data is untouched. */
const revokeUserSessions = adminProcedure
  .input(z.object({ userId: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    await requireOtherUser(context.user.id, input.userId, 'sign out')
    const revoked = await db
      .delete(authSession)
      .where(eq(authSession.userId, input.userId))
      .returning({ id: authSession.id })
    return { revoked: revoked.length }
  })

/** Disconnect every MCP client authorized by an account. */
const revokeUserMcpAccess = adminProcedure
  .input(z.object({ userId: z.string().min(1).max(128) }))
  .handler(async ({ input }) => {
    const [tokens, consents] = await Promise.all([
      db
        .delete(oauthAccessToken)
        .where(eq(oauthAccessToken.userId, input.userId))
        .returning({ id: oauthAccessToken.id }),
      db
        .delete(oauthConsent)
        .where(eq(oauthConsent.userId, input.userId))
        .returning({ id: oauthConsent.id }),
    ])
    return { tokens: tokens.length, consents: consents.length }
  })

const listRecentDesigns = adminProcedure
  .input(
    z
      .object({
        search: z.string().trim().max(200).optional(),
        limit: z.number().int().min(1).max(100).default(25),
      })
      .default({ limit: 25 }),
  )
  .handler(async ({ input }) => {
    const search = input.search?.trim()
    const rows = await db
      .select({
        id: design.id,
        name: design.name,
        userId: design.userId,
        ownerName: user.name,
        ownerEmail: user.email,
        linkAccess: design.linkAccess,
        revision: design.revision,
        createdAt: design.createdAt,
        updatedAt: design.updatedAt,
      })
      .from(design)
      .innerJoin(user, eq(design.userId, user.id))
      .where(
        search
          ? or(
              ilike(design.name, likeTerm(search)),
              ilike(user.email, likeTerm(search)),
            )
          : undefined,
      )
      .orderBy(desc(design.updatedAt))
      .limit(input.limit)

    if (rows.length === 0) return []

    const now = new Date()
    const ids = rows.map((row) => row.id)
    const [publishRows, shareRows] = await Promise.all([
      db
        .select({ designId: publishLink.designId, links: count() })
        .from(publishLink)
        .where(and(inArray(publishLink.designId, ids), gt(publishLink.expiresAt, now)))
        .groupBy(publishLink.designId),
      db
        .select({ designId: designShare.designId, shares: count() })
        .from(designShare)
        .where(inArray(designShare.designId, ids))
        .groupBy(designShare.designId),
    ])
    const publishBy = new Map(publishRows.map((row) => [row.designId, row.links]))
    const shareBy = new Map(shareRows.map((row) => [row.designId, row.shares]))

    return rows.map((row) => ({
      ...row,
      livePublishLinks: toCount(publishBy.get(row.id)),
      shares: toCount(shareBy.get(row.id)),
    }))
  })

/**
 * Takedown for a design that is public when it should not be: every live
 * publish link is dropped and the editor link falls back to restricted. The
 * document itself is left alone.
 */
const revokeDesignLinks = adminProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      userId: z.string().min(1).max(128),
    }),
  )
  .handler(async ({ input }) => {
    const [target] = await db
      .select({ id: design.id })
      .from(design)
      .where(and(eq(design.id, input.designId), eq(design.userId, input.userId)))
      .limit(1)
    if (!target) throw new ORPCError('NOT_FOUND')

    const [links] = await Promise.all([
      db
        .delete(publishLink)
        .where(
          and(
            eq(publishLink.designId, input.designId),
            eq(publishLink.userId, input.userId),
          ),
        )
        .returning({ id: publishLink.id }),
      db
        .update(design)
        .set({ linkAccess: 'restricted', updatedAt: new Date() })
        .where(and(eq(design.id, input.designId), eq(design.userId, input.userId))),
    ])
    return { revokedLinks: links.length }
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

const deleteUserAccount = adminProcedure
  .input(
    z.object({
      userId: z.string().min(1).max(128),
      email: z.string().trim().email().max(320),
    }),
  )
  .handler(async ({ context, input }) => {
    if (input.userId === context.user.id) {
      throw new ORPCError('FORBIDDEN', {
        message: 'You cannot delete your own account from Admin.',
      })
    }

    const [target] = await db
      .select({ id: user.id, email: user.email, isAdmin: user.isAdmin })
      .from(user)
      .where(eq(user.id, input.userId))
      .limit(1)
    if (!target) throw new ORPCError('NOT_FOUND')
    if (target.isAdmin) {
      throw new ORPCError('FORBIDDEN', {
        message: 'Admin accounts cannot be deleted.',
      })
    }
    if (target.email !== input.email) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'Email confirmation does not match.',
      })
    }

    await deleteUserAccountData(target.id)
    return { deleted: true }
  })

const getPreferences = protectedProcedure.handler(async ({ context }) => {
  const [row] = await db
    .select({ shortcuts: userPreferences.shortcuts })
    .from(userPreferences)
    .where(eq(userPreferences.userId, context.user.id))
    .limit(1)
  return {
    shortcuts: row ? parseShortcutConfig(row.shortcuts) : EMPTY_SHORTCUT_CONFIG,
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

export const appRouter = {
  auth: {
    config: getAuthConfig,
    legalConsent: getLegalConsent,
    acceptLegal,
    previewAccess: getPreviewAccess,
    requestPreviewAccess,
    deleteAccount,
  },
  preferences: {
    get: getPreferences,
    save: savePreferences,
  },
  billing: {
    status: getCurrentBilling,
    refresh: refreshCurrentBilling,
    checkout: createSubscriptionCheckout,
    mcpUsage: getCurrentMcpUsage,
  },
  design: {
    list: listDesigns,
    listShared: listDesignsSharedWithMe,
    get: getDesign,
    save: saveDesign,
    delete: deleteDesign,
  },
  share: {
    get: getDesignShare,
    setLinkAccess: setDesignLinkAccess,
    invite: inviteDesignCollaborator,
    setRole: setDesignCollaboratorRole,
    revoke: revokeDesignCollaborator,
    leave: leaveDesignShare,
  },
  canvas: {
    create: createCanvasDesign,
    get: getCanvas,
    rename: renameCanvasDesign,
    applyTransactions: applyCanvasTransactions,
  },
  draft: {
    list: listDrafts,
    create: createDraft,
    get: getDraft,
    save: saveDraft,
    rename: renameDraft,
    propose: proposeDraft,
    reopen: reopenDraft,
    compare: compareDraft,
    apply: applyDraft,
    close: closeDraft,
  },
  handoff: {
    create: createDesignHandoff,
  },
  history: {
    list: listVersions,
    compare: compareVersion,
    import: importVersions,
    commit: commitVersion,
    commitCanvas: commitCanvasVersion,
    compareCanvas: compareCanvasVersion,
    restoreCanvas: restoreCanvasVersion,
  },
  asset: {
    list: listAssets,
    upload: uploadAsset,
    delete: deleteAsset,
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
  mcp: {
    sessions: listMcpSessions,
    revoke: revokeMcpSession,
  },
  admin: {
    overview: adminOverview,
    listUsers: listUsersWithUsage,
    setPreviewAccess: setUserPreviewAccess,
    approvePendingPreviewAccess,
    setAdmin: setUserAdmin,
    refreshBilling: refreshUserBilling,
    revokeSessions: revokeUserSessions,
    revokeMcpAccess: revokeUserMcpAccess,
    deleteUser: deleteUserAccount,
    listDesigns: listRecentDesigns,
    revokeDesignLinks,
  },
}
