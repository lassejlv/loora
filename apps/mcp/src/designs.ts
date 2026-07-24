import { and, asc, desc, eq, isNull, or } from 'drizzle-orm'
import { db } from '@loora/db'
import { asset, design, designDraft, designVersion } from '@loora/db/schema'
import type { CanvasElement } from '@loora/db/canvas'
import { canvasDiff, mergeCanvas, type MergeChoice } from '@loora/db/drafts'

// Mirrors the oRPC shape limits (packages/rpc/src/router.ts) so anything the
// MCP server writes stays loadable and saveable by the web app.
export const MAX_ELEMENTS = 10_000
export const MAX_CODE_LENGTH = 200_000
export const MAX_NAME_LENGTH = 200

let counter = 0
function suffix() {
  counter += 1
  return `${Date.now().toString(36)}${counter}`
}

export const newDesignId = () => `d${suffix()}`
export const newDraftId = () => `dr${suffix()}`
export const newElementId = () => `e${suffix()}`

export async function listDesigns(userId: string) {
  const rows = await db
    .select({
      id: design.id,
      name: design.name,
      revision: design.revision,
      updatedAt: design.updatedAt,
    })
    .from(design)
    .where(eq(design.userId, userId))
    .orderBy(asc(design.createdAt))
  return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }))
}

export async function getDesign(userId: string, id: string, draftId?: string | null) {
  if (draftId) {
    const [found] = await db
      .select({
        id: design.id,
        name: design.name,
        draftName: designDraft.name,
        shapes: designDraft.shapes,
        revision: designDraft.revision,
        status: designDraft.status,
        updatedAt: designDraft.updatedAt,
      })
      .from(designDraft)
      .innerJoin(
        design,
        and(eq(design.id, designDraft.designId), eq(design.userId, designDraft.userId)),
      )
      .where(
        and(
          eq(designDraft.id, draftId),
          eq(designDraft.designId, id),
          eq(designDraft.userId, userId),
        ),
      )
      .limit(1)
    if (!found) throw new Error(`Draft "${draftId}" not found in design "${id}"`)
    return { ...found, draftId }
  }
  const [found] = await db
    .select({
      id: design.id,
      name: design.name,
      shapes: design.shapes,
      revision: design.revision,
      updatedAt: design.updatedAt,
    })
    .from(design)
    .where(and(eq(design.id, id), eq(design.userId, userId)))
    .limit(1)
  if (!found) throw new Error(`Design "${id}" not found`)
  return { ...found, draftId: null, draftName: null, status: 'active' as const }
}

export async function mutateShapes(
  userId: string,
  id: string,
  draftId: string | null | undefined,
  mutate: (shapes: CanvasElement[]) => CanvasElement[],
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const found = await getDesign(userId, id, draftId)
    if (found.status !== 'active') throw new Error(`Draft "${draftId}" is read-only`)
    const shapes = mutate(found.shapes)
    if (shapes.length > MAX_ELEMENTS) {
      throw new Error(`Designs are capped at ${MAX_ELEMENTS} elements`)
    }
    const now = new Date()
    const updated = draftId
      ? await db
          .update(designDraft)
          .set({ shapes, revision: found.revision + 1, updatedAt: now })
          .where(
            and(
              eq(designDraft.id, draftId),
              eq(designDraft.designId, id),
              eq(designDraft.userId, userId),
              eq(designDraft.status, 'active'),
              eq(designDraft.revision, found.revision),
            ),
          )
          .returning({ revision: designDraft.revision })
      : await db
          .update(design)
          .set({ shapes, revision: found.revision + 1, updatedAt: now })
          .where(
            and(
              eq(design.id, id),
              eq(design.userId, userId),
              eq(design.revision, found.revision),
            ),
          )
          .returning({ revision: design.revision })
    if (updated[0]) return { shapes, revision: updated[0].revision }
  }
  throw new Error('The canvas changed repeatedly; read it again before retrying.')
}

export async function createDesign(userId: string, name: string) {
  const [created] = await db
    .insert(design)
    .values({ id: newDesignId(), userId, name, shapes: [] })
    .returning({ id: design.id, name: design.name, revision: design.revision })
  return created
}

export async function renameDesign(userId: string, id: string, name: string) {
  const updated = await db
    .update(design)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(design.id, id), eq(design.userId, userId)))
    .returning({ id: design.id, name: design.name })
  if (updated.length === 0) throw new Error(`Design "${id}" not found`)
  return updated[0]
}

export async function deleteDesign(userId: string, id: string) {
  const deleted = await db
    .delete(design)
    .where(and(eq(design.id, id), eq(design.userId, userId)))
    .returning({ id: design.id })
  return deleted.length > 0
}

export async function listVersions(
  userId: string,
  designId: string,
  limit: number,
  draftId?: string | null,
) {
  const rows = await db
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
        eq(designVersion.designId, designId),
        eq(designVersion.userId, userId),
        draftId ? eq(designVersion.draftId, draftId) : isNull(designVersion.draftId),
      ),
    )
    .orderBy(desc(designVersion.createdAt), desc(designVersion.id))
    .limit(limit)
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
}

export async function listDrafts(userId: string, designId: string) {
  const rows = await db
    .select({
      id: designDraft.id,
      name: designDraft.name,
      description: designDraft.description,
      status: designDraft.status,
      baseRevision: designDraft.baseRevision,
      revision: designDraft.revision,
      createdAt: designDraft.createdAt,
      updatedAt: designDraft.updatedAt,
    })
    .from(designDraft)
    .where(and(eq(designDraft.designId, designId), eq(designDraft.userId, userId)))
    .orderBy(desc(designDraft.updatedAt))
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }))
}

export async function createDraft(userId: string, designId: string, name: string) {
  const main = await getDesign(userId, designId)
  const [created] = await db
    .insert(designDraft)
    .values({
      id: newDraftId(),
      designId,
      userId,
      name,
      baseShapes: main.shapes,
      shapes: main.shapes,
      baseRevision: main.revision,
    })
    .returning({
      id: designDraft.id,
      name: designDraft.name,
      status: designDraft.status,
      revision: designDraft.revision,
    })
  return created
}

async function transitionDraft(
  userId: string,
  designId: string,
  draftId: string,
  from: 'active' | 'proposed' | Array<'active' | 'proposed'>,
  to: 'active' | 'proposed' | 'closed',
  description?: string,
) {
  const allowed = Array.isArray(from) ? from : [from]
  const now = new Date()
  const [updated] = await db
    .update(designDraft)
    .set({
      status: to,
      ...(description !== undefined ? { description } : {}),
      proposedAt: to === 'proposed' ? now : to === 'active' ? null : undefined,
      closedAt: to === 'closed' ? now : undefined,
      updatedAt: now,
    })
    .where(
      and(
        eq(designDraft.id, draftId),
        eq(designDraft.designId, designId),
        eq(designDraft.userId, userId),
        allowed.length === 1
          ? eq(designDraft.status, allowed[0])
          : or(...allowed.map((status) => eq(designDraft.status, status))),
      ),
    )
    .returning({ id: designDraft.id, status: designDraft.status })
  if (!updated) throw new Error(`Draft "${draftId}" cannot transition to ${to}`)
  return updated
}

export const proposeDraft = (
  userId: string,
  designId: string,
  draftId: string,
  description = '',
) => transitionDraft(userId, designId, draftId, 'active', 'proposed', description)

export const reopenDraft = (userId: string, designId: string, draftId: string) =>
  transitionDraft(userId, designId, draftId, 'proposed', 'active')

export const closeDraft = (userId: string, designId: string, draftId: string) =>
  transitionDraft(userId, designId, draftId, ['active', 'proposed'], 'closed')

export async function compareDraft(userId: string, designId: string, draftId: string) {
  const [main, draft] = await Promise.all([
    getDesign(userId, designId),
    db
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
      .then((rows) => rows[0]),
  ])
  if (!draft) throw new Error(`Draft "${draftId}" not found`)
  const merge = mergeCanvas(draft.baseShapes, main.shapes, draft.shapes)
  return {
    designId,
    draftId,
    status: draft.status,
    mainRevision: main.revision,
    draftRevision: draft.revision,
    summary: merge.summary,
    conflicts: merge.conflicts,
  }
}

export async function applyDraft(
  userId: string,
  designId: string,
  draftId: string,
  expectedMainRevision: number,
  expectedDraftRevision: number,
  resolutions: Record<string, MergeChoice>,
) {
  const [main, draft] = await Promise.all([
    getDesign(userId, designId),
    db
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
      .then((rows) => rows[0]),
  ])
  if (!draft) throw new Error(`Draft "${draftId}" not found`)
  if (main.revision !== expectedMainRevision || draft.revision !== expectedDraftRevision) {
    throw new Error('Main or the draft changed during review')
  }
  if (draft.status !== 'active' && draft.status !== 'proposed') {
    throw new Error(`Draft "${draftId}" is already archived`)
  }
  const merge = mergeCanvas(draft.baseShapes, main.shapes, draft.shapes, resolutions)
  if (merge.unresolved.length > 0) {
    return { applied: false as const, unresolved: merge.unresolved, conflicts: merge.conflicts }
  }

  const beforeId = `v${crypto.randomUUID().replaceAll('-', '')}`
  const appliedId = `v${crypto.randomUUID().replaceAll('-', '')}`
  const now = new Date()
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(design)
      .set({ shapes: merge.shapes, revision: main.revision + 1, updatedAt: now })
      .where(
        and(
          eq(design.id, designId),
          eq(design.userId, userId),
          eq(design.revision, main.revision),
        ),
      )
      .returning({ id: design.id })
    if (!updated) throw new Error('Main changed while applying the draft')
    await tx.insert(designVersion).values([
      {
        id: beforeId,
        designId,
        userId,
        message: `Before applying: ${draft.name}`,
        shapes: main.shapes,
        ...canvasDiff([], main.shapes),
      },
      {
        id: appliedId,
        designId,
        userId,
        message: `Applied draft: ${draft.name}`,
        shapes: merge.shapes,
        ...canvasDiff(main.shapes, merge.shapes),
      },
    ])
    const [archived] = await tx
      .update(designDraft)
      .set({
        status: 'applied',
        appliedAt: now,
        appliedVersionId: appliedId,
        updatedAt: now,
      })
      .where(
        and(
          eq(designDraft.id, draftId),
          eq(designDraft.designId, designId),
          eq(designDraft.userId, userId),
          eq(designDraft.revision, draft.revision),
          or(eq(designDraft.status, 'active'), eq(designDraft.status, 'proposed')),
        ),
      )
      .returning({ id: designDraft.id })
    if (!archived) throw new Error('The draft changed while applying')
  })
  return {
    applied: true as const,
    revision: main.revision + 1,
    versionId: appliedId,
  }
}

export async function listAssets(userId: string) {
  const rows = await db
    .select({
      id: asset.id,
      name: asset.name,
      mediaType: asset.mediaType,
      size: asset.size,
      createdAt: asset.createdAt,
    })
    .from(asset)
    .where(eq(asset.userId, userId))
    .orderBy(desc(asset.createdAt))
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
}

export function summarizeElement(element: CanvasElement) {
  const { code, ...rest } = element
  const firstLine = code.split('\n', 1)[0] ?? ''
  return {
    ...rest,
    codeLength: code.length,
    codePreview: firstLine.length > 120 ? `${firstLine.slice(0, 120)}…` : firstLine,
  }
}

export function searchElements(shapes: CanvasElement[], query: string, maxMatches = 50) {
  const needle = query.toLowerCase()
  const matches: { elementId: string; elementName: string; line: number; text: string }[] = []
  for (const shape of shapes) {
    const lines = shape.code.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].toLowerCase().includes(needle)) continue
      matches.push({
        elementId: shape.id,
        elementName: shape.name,
        line: i + 1,
        text: lines[i].trim().slice(0, 200),
      })
      if (matches.length >= maxMatches) return { matches, truncated: true }
    }
  }
  return { matches, truncated: false }
}
