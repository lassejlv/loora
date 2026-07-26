import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@loora/db'
import { asset, design, designDraft, user } from '@loora/db/schema'
import { readHandoffToken } from './handoff-token'
import type { CanvasElement } from '@loora/db/canvas'
import { authorizeBilling } from '@loora/billing/billing'
import { canUseApp } from '@loora/auth/preview-access'
import {
  CANVAS_SCHEMA_VERSION,
  parseCanvasDocument,
  type CanvasDocumentV2,
} from '@loora/canvas/model'

export function referencedAssetIds(
  sourceDocument: CanvasElement[] | CanvasDocumentV2,
) {
  const ids = new Set<string>()
  const source = JSON.stringify(sourceDocument)
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
      canvasVersion: design.canvasVersion,
      canvasDocument: design.canvasDocument,
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
  let canvasVersion = found.canvasVersion
  let canvasDocument = found.canvasDocument
  let updatedAt = found.updatedAt
  if (claims.draftId) {
    const [draft] = await db
      .select({
        shapes: designDraft.shapes,
        pages: designDraft.pages,
        canvasVersion: designDraft.canvasVersion,
        canvasDocument: designDraft.canvasDocument,
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
    canvasVersion = draft.canvasVersion
    canvasDocument = draft.canvasDocument
    updatedAt = draft.updatedAt
  }
  const {
    isAdmin: _isAdmin,
    previewAccess: _previewAccess,
    shapes: _shapes,
    pages: _pages,
    canvasVersion: _canvasVersion,
    canvasDocument: _canvasDocument,
    updatedAt: _updatedAt,
    ...handoff
  } = found
  return {
    ...handoff,
    shapes,
    pages,
    canvasVersion,
    document:
      canvasVersion === CANVAS_SCHEMA_VERSION && canvasDocument
        ? parseCanvasDocument(canvasDocument)
        : null,
    updatedAt,
    userId: claims.userId,
  }
}

export async function buildHandoffPayload(token: string, origin: string) {
  const found = await getHandoffDesign(token)
  if (!found) return null

  const assetIds = referencedAssetIds(found.document ?? found.shapes)
  const assets = assetIds.size
    ? await db
        .select({ id: asset.id, name: asset.name, mediaType: asset.mediaType, size: asset.size })
        .from(asset)
        .where(and(eq(asset.userId, found.userId), inArray(asset.id, [...assetIds])))
    : []

  const common = {
    schema: 'loora.design-handoff',
    assets: assets
      .filter((item) => assetIds.has(item.id))
      .map((item) => ({
        ...item,
        source: `/api/asset/${item.id}`,
        url: `${origin}/api/handoff/${encodeURIComponent(token)}/asset/${encodeURIComponent(item.id)}`,
      })),
  }
  if (found.document) {
    return {
      ...common,
      version: 3,
      design: {
        id: found.id,
        name: found.name,
        updatedAt: found.updatedAt.toISOString(),
        document: found.document,
      },
      guidance: {
        sourceOfTruth:
          'CanvasDocumentV2 is normalized structured UI data. Do not look for or execute source strings.',
        hierarchy:
          'Use parentId and numeric order to reconstruct Pages, components, frames, and content nodes.',
        layout:
          'Render structured absolute, flex, and grid layout plus responsive breakpoint overrides.',
        components:
          'Instances reference off-canvas component roots and carry field-level overrides.',
      },
    }
  }
  return {
    ...common,
    version: 2,
    design: {
      id: found.id,
      name: found.name,
      updatedAt: found.updatedAt.toISOString(),
      shapes: found.shapes,
      pages: found.pages,
    },
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
