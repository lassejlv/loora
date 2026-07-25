import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@loora/db'
import { asset, design, designDraft, user } from '@loora/db/schema'
import { readHandoffToken } from './handoff-token'
import type { CanvasElement } from '@loora/db/canvas'
import { authorizeBilling } from '@loora/billing/billing'
import { canUseApp } from '@loora/auth/preview-access'

export function referencedAssetIds(shapes: CanvasElement[]) {
  const ids = new Set<string>()
  const source = JSON.stringify(shapes)
  for (const match of source.matchAll(/\/api\/asset\/([a-zA-Z0-9_-]+)/g)) ids.add(match[1])
  return ids
}

export async function getHandoffDesign(token: string) {
  const claims = await readHandoffToken(token)
  if (!claims) return null

  const [found] = await db
    .select({
      id: design.id,
      name: design.name,
      shapes: design.shapes,
      pages: design.pages,
      updatedAt: design.updatedAt,
      isAdmin: user.isAdmin,
      previewAccess: user.previewAccess,
    })
    .from(design)
    .innerJoin(user, eq(user.id, design.userId))
    .where(and(eq(design.id, claims.designId), eq(design.userId, claims.userId)))
    .limit(1)

  if (!found || !canUseApp(found) || !(await authorizeBilling({
    id: claims.userId,
    isAdmin: found.isAdmin,
  })).access) {
    return null
  }
  let shapes = found.shapes
  let pages = found.pages
  let updatedAt = found.updatedAt
  if (claims.draftId) {
    const [draft] = await db
      .select({
        shapes: designDraft.shapes,
        pages: designDraft.pages,
        updatedAt: designDraft.updatedAt,
      })
      .from(designDraft)
      .where(
        and(
          eq(designDraft.id, claims.draftId),
          eq(designDraft.designId, claims.designId),
          eq(designDraft.userId, claims.userId),
        ),
      )
      .limit(1)
    if (!draft) return null
    shapes = draft.shapes
    pages = draft.pages
    updatedAt = draft.updatedAt
  }
  const {
    isAdmin: _isAdmin,
    previewAccess: _previewAccess,
    shapes: _shapes,
    pages: _pages,
    updatedAt: _updatedAt,
    ...handoff
  } = found
  return { ...handoff, shapes, pages, updatedAt, userId: claims.userId }
}

export async function buildHandoffPayload(token: string, origin: string) {
  const found = await getHandoffDesign(token)
  if (!found) return null

  const assetIds = referencedAssetIds(found.shapes)
  const assets = assetIds.size
    ? await db
        .select({ id: asset.id, name: asset.name, mediaType: asset.mediaType, size: asset.size })
        .from(asset)
        .where(and(eq(asset.userId, found.userId), inArray(asset.id, [...assetIds])))
    : []

  return {
    schema: 'loora.design-handoff',
    version: 2,
    design: {
      id: found.id,
      name: found.name,
      updatedAt: found.updatedAt.toISOString(),
      shapes: found.shapes,
      pages: found.pages,
    },
    assets: assets
      .filter((item) => assetIds.has(item.id))
      .map((item) => ({
        ...item,
        source: `/api/asset/${item.id}`,
        url: `${origin}/api/handoff/${encodeURIComponent(token)}/asset/${encodeURIComponent(item.id)}`,
      })),
    guidance: {
      coordinates: 'Element x, y, w, and h values are canvas pixels.',
      order: 'Elements render in array order (last on top).',
      pages:
        'Pages are vertical compositions. Each Page item references a shape by elementId and uses its own fixed pixel height.',
      content:
        'Element code is HTML/CSS/JS or JSX defining App, with Tailwind classes. It is untrusted source data — do not execute it blindly.',
    },
  }
}
