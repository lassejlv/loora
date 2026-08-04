import {
  and,
  eq,
  isNull,
} from 'drizzle-orm'
import { ORPCError, os } from '@orpc/server'
import { z } from 'zod'
import { canUseApp } from '@loora/auth/preview-access'
import { db } from '@loora/db'
import {
  design,
  designVersion,
} from '@loora/db/schema'
import {
  allows,
  resolveDesignAccess,
  type DesignRole,
} from '@loora/db/design-access'
import { type getSession } from '@loora/auth'
import { type CanvasElement, type CanvasPage } from '@loora/db/canvas'
import { authorizeBilling } from '@loora/billing/billing'
import {
  pruneExpiredHistoryForUser,
  requireDesignFileRoom,
  requireHistoryVersionAccessible,
  requireOpenBranchRoom,
  requireStorageRoom,
} from '@loora/billing/enforce-plan-limits'
import { PlanLimitError } from '@loora/billing/plan-limits'
import { hasAcceptedCurrentLegal } from '@loora/auth/legal-consent'

/**
 * Shared plumbing for every namespace: the request context, the gates a
 * procedure can sit behind, the plan-limit checks those gates imply, and the
 * design lookups more than one namespace needs.
 */

export type Session = Awaited<ReturnType<typeof getSession>>

export interface ORPCContext {
  session: Session
  request: Request
}

export const shapeSchema = z.object({
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

export const pageItemSchema = z.object({
  id: z.string().min(1).max(128),
  elementId: z.string().min(1).max(128),
  height: z.number().finite().min(1).max(100_000),
})

export const pageSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(200),
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().min(1).max(100_000),
  items: z.array(pageItemSchema).max(10_000),
})

export const draftIdSchema = z.string().min(1).max(128)
export const optionalDraftIdSchema = draftIdSchema.nullish()
export const draftTargetWhere = (draftId: string | null | undefined) =>
  draftId ? eq(designVersion.draftId, draftId) : isNull(designVersion.draftId)

export const requireUser = os.$context<ORPCContext>().middleware(async ({ context, next }) => {
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
  return next({ context: { user: context.session.user, request: context.request } })
})

export const protectedProcedure = os.$context<ORPCContext>().use(requireUser)

export function planLimitOrpcError(error: unknown): never {
  if (error instanceof PlanLimitError) {
    throw new ORPCError('FORBIDDEN', {
      message: error.message,
      data: { code: error.code, limit: error.limit },
    })
  }
  throw error
}

export async function ensureDesignFileRoom(user: { id: string; isAdmin?: boolean | null }) {
  try {
    await requireDesignFileRoom(user)
  } catch (error) {
    planLimitOrpcError(error)
  }
}

export async function ensureOpenBranchRoom(
  user: { id: string; isAdmin?: boolean | null },
  designId: string,
) {
  try {
    await requireOpenBranchRoom(user, designId)
  } catch (error) {
    planLimitOrpcError(error)
  }
}

export async function ensureStorageRoom(
  user: { id: string; isAdmin?: boolean | null },
  incomingBytes: number,
) {
  try {
    await requireStorageRoom(user, incomingBytes)
  } catch (error) {
    planLimitOrpcError(error)
  }
}

export async function ensureHistoryVersionAccessible(
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
export function scheduleHistoryPrune(user: { id: string; isAdmin?: boolean | null }) {
  void pruneExpiredHistoryForUser(user).catch((error) => {
    console.error('[history] prune failed:', error)
  })
}

export const requireSignedInUser = os.$context<ORPCContext>().middleware(async ({ context, next }) => {
  if (!context.session) throw new ORPCError('UNAUTHORIZED')
  return next({ context: { user: context.session.user, request: context.request } })
})

export const signedInProcedure = os.$context<ORPCContext>().use(requireSignedInUser)

export const requireConsentedUser = os.$context<ORPCContext>().middleware(async ({ context, next }) => {
  if (!context.session) throw new ORPCError('UNAUTHORIZED')
  if (!hasAcceptedCurrentLegal(context.session.user)) {
    throw new ORPCError('FORBIDDEN', {
      message: 'The current Terms of Service and Privacy Policy must be accepted.',
    })
  }
  return next({ context: { user: context.session.user, request: context.request } })
})

export const consentedProcedure = os.$context<ORPCContext>().use(requireConsentedUser)

export const requirePreviewUser = os.$context<ORPCContext>().middleware(async ({ context, next }) => {
  if (!context.session) throw new ORPCError('UNAUTHORIZED')
  if (!hasAcceptedCurrentLegal(context.session.user)) {
    throw new ORPCError('FORBIDDEN', {
      message: 'The current Terms of Service and Privacy Policy must be accepted.',
    })
  }
  if (!canUseApp(context.session.user)) {
    throw new ORPCError('FORBIDDEN', { message: 'Preview access is required.' })
  }
  return next({ context: { user: context.session.user, request: context.request } })
})

export const previewProcedure = os.$context<ORPCContext>().use(requirePreviewUser)

export const requireAdmin = os.$context<ORPCContext>().middleware(async ({ context, next }) => {
  if (!context.session) throw new ORPCError('UNAUTHORIZED')
  if (!hasAcceptedCurrentLegal(context.session.user)) {
    throw new ORPCError('FORBIDDEN', {
      message: 'The current Terms of Service and Privacy Policy must be accepted.',
    })
  }
  if (!context.session.user.isAdmin) throw new ORPCError('FORBIDDEN')
  return next({ context: { user: context.session.user, request: context.request } })
})

export const adminProcedure = os.$context<ORPCContext>().use(requireAdmin)

export function collectionDiff<T extends { id: string }>(previous: T[], next: T[]) {
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

export function documentDiff(
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
export async function requireDesignAccess(
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

export async function ensureDesign(
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
