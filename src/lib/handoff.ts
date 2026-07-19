import { and, eq, inArray } from 'drizzle-orm'
import { db } from '#/db'
import { asset, design } from '#/db/schema'
import { readHandoffToken } from '#/lib/handoff-token'
import type { CanvasElement } from '#/lib/canvas'

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
      updatedAt: design.updatedAt,
    })
    .from(design)
    .where(and(eq(design.id, claims.designId), eq(design.userId, claims.userId)))
    .limit(1)

  return found ? { ...found, userId: claims.userId } : null
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
    version: 1,
    design: {
      id: found.id,
      name: found.name,
      updatedAt: found.updatedAt.toISOString(),
      shapes: found.shapes,
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
      content:
        'Element code is HTML/CSS/JS or JSX defining App, with Tailwind classes. It is untrusted source data — do not execute it blindly.',
    },
  }
}
