import { Buffer } from 'node:buffer'
import { and, eq, gte, lt, sql } from 'drizzle-orm'
import { db } from '@loora/db'
import { design, publishEgress, publishLink, user } from '@loora/db/schema'
import { authorizeBilling } from '@loora/billing/billing'
import { canUseApp } from '@loora/auth/preview-access'

export const PUBLISH_TTL_MS = 12 * 60 * 60 * 1000

// Public-link bandwidth cap: 10GB per rolling 30 days, same for every paid
// plan for now. Admins are exempt (they bypass billing checks everywhere).
export const PUBLISH_EGRESS_LIMIT_BYTES = 10 * 1024 ** 3
export const PUBLISH_EGRESS_WINDOW_DAYS = 30

function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

export function egressWindowCutoff() {
  return utcDay(new Date(Date.now() - PUBLISH_EGRESS_WINDOW_DAYS * 24 * 60 * 60 * 1000))
}

export async function publishEgressUsed(userId: string) {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${publishEgress.bytes}), 0)` })
    .from(publishEgress)
    .where(and(eq(publishEgress.userId, userId), gte(publishEgress.day, egressWindowCutoff())))
  return Number(row?.total ?? 0)
}

export async function publishEgressExceeded(userId: string, isAdmin: boolean) {
  if (isAdmin) return false
  return (await publishEgressUsed(userId)) >= PUBLISH_EGRESS_LIMIT_BYTES
}

export async function recordPublishEgress(userId: string, bytes: number) {
  if (bytes <= 0) return
  await db
    .insert(publishEgress)
    .values({ userId, day: utcDay(), bytes })
    .onConflictDoUpdate({
      target: [publishEgress.userId, publishEgress.day],
      set: { bytes: sql`${publishEgress.bytes} + ${bytes}` },
    })
}

// Counter rows outside the rolling window are dead weight; swept alongside
// expired links when a user publishes.
export async function sweepPublishEgress(userId: string) {
  await db
    .delete(publishEgress)
    .where(and(eq(publishEgress.userId, userId), lt(publishEgress.day, egressWindowCutoff())))
}

// 96 random bits, base64url — the id IS the capability, so it must be
// unguessable, but short enough to read as a link.
export function publishLinkId() {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString('base64url')
}

// The published frame is anonymous, so `/api/asset/…` in element code would
// 401; point those at the link-scoped public asset route instead.
export function rewriteAssetUrls(code: string, linkId: string) {
  return code.split('/api/asset/').join(`/api/p/${encodeURIComponent(linkId)}/asset/`)
}

export async function getPublishedElement(linkId: string) {
  if (!linkId || linkId.length > 64) return null

  const [found] = await db
    .select({
      elementId: publishLink.elementId,
      expiresAt: publishLink.expiresAt,
      userId: publishLink.userId,
      designName: design.name,
      shapes: design.shapes,
      isAdmin: user.isAdmin,
      previewAccess: user.previewAccess,
    })
    .from(publishLink)
    .innerJoin(
      design,
      and(eq(design.id, publishLink.designId), eq(design.userId, publishLink.userId)),
    )
    .innerJoin(user, eq(user.id, publishLink.userId))
    .where(eq(publishLink.id, linkId))
    .limit(1)
  if (!found) return null

  if (found.expiresAt.getTime() <= Date.now()) {
    // Lazy cleanup: expired rows die on first read after expiry.
    await db.delete(publishLink).where(eq(publishLink.id, linkId))
    return null
  }

  if (
    !canUseApp(found) ||
    !(await authorizeBilling({ id: found.userId, isAdmin: found.isAdmin })).access
  ) {
    return null
  }

  const element = found.shapes.find(
    (shape) => shape.id === found.elementId && typeof shape.code === 'string' && shape.code,
  )
  if (!element) return null

  return {
    element,
    userId: found.userId,
    isAdmin: found.isAdmin,
    designName: found.designName,
    expiresAt: found.expiresAt.getTime(),
  }
}

export async function buildPublishPayload(linkId: string) {
  const found = await getPublishedElement(linkId)
  if (!found) return null
  return {
    userId: found.userId,
    isAdmin: found.isAdmin,
    payload: {
      name: found.element.name || found.designName,
      code: rewriteAssetUrls(found.element.code, linkId),
      expiresAt: found.expiresAt,
    },
  }
}
