import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  or,
} from 'drizzle-orm'
import { db } from '@loora/db'
import {
  asset,
  canvasTransaction as canvasTransactionLog,
  design,
  designDraft,
  designVersion,
} from '@loora/db/schema'
import {
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
} from '@loora/canvas/merge'
import { publishCanvasRealtimeEvent } from '@loora/db/canvas-realtime'
import { canvasTransactionPruneBefore } from '@loora/db/canvas-transactions'
import {
  requireDesignFileRoomForPlan,
  requireOpenBranchRoomForPlan,
} from '@loora/billing/enforce-plan-limits'
import type { LimitsPlan } from '@loora/billing/plan-limits'

export const MAX_NAME_LENGTH = 200

let counter = 0
function suffix() {
  counter += 1
  return `${Date.now().toString(36)}${counter}`
}

export const newDesignId = () => `d${suffix()}`
export const newDraftId = () => `dr${suffix()}`

export class CanvasUnavailableError extends Error {
  readonly code = 'CANVAS_UNAVAILABLE'

  constructor(readonly designId: string) {
    super('This design uses an unsupported legacy Canvas format.')
  }
}

export interface CanvasTarget {
  designId: string
  draftId?: string | null
}

export async function listDesigns(userId: string) {
  const rows = await db
    .select({
      id: design.id,
      name: design.name,
      canvasVersion: design.canvasVersion,
      revision: design.revision,
      updatedAt: design.updatedAt,
    })
    .from(design)
    .where(eq(design.userId, userId))
    .orderBy(asc(design.createdAt))
  return rows.map((row) => ({
    ...row,
    available: row.canvasVersion === CANVAS_SCHEMA_VERSION,
    updatedAt: row.updatedAt.toISOString(),
  }))
}

export async function getCanvasTarget(
  userId: string,
  target: CanvasTarget,
): Promise<{
  id: string
  name: string
  draftId: string | null
  draftName: string | null
  status: 'active' | 'proposed' | 'applied' | 'closed'
  document: CanvasDocument
  revision: number
  updatedAt: Date
}> {
  if (target.draftId) {
    const [found] = await db
      .select({
        id: design.id,
        name: design.name,
        draftName: designDraft.name,
        canvasVersion: designDraft.canvasVersion,
        document: designDraft.canvasDocument,
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
          eq(designDraft.id, target.draftId),
          eq(designDraft.designId, target.designId),
          eq(designDraft.userId, userId),
        ),
      )
      .limit(1)
    if (!found) {
      throw new Error(
        `Draft "${target.draftId}" not found in design "${target.designId}"`,
      )
    }
    if (found.canvasVersion !== CANVAS_SCHEMA_VERSION || !found.document) {
      throw new CanvasUnavailableError(target.designId)
    }
    return {
      id: found.id,
      name: found.name,
      draftId: target.draftId,
      draftName: found.draftName,
      status: found.status,
      document: parseCanvasDocument(found.document),
      revision: found.revision,
      updatedAt: found.updatedAt,
    }
  }

  const [found] = await db
    .select({
      id: design.id,
      name: design.name,
      canvasVersion: design.canvasVersion,
      document: design.canvasDocument,
      revision: design.revision,
      updatedAt: design.updatedAt,
    })
    .from(design)
    .where(and(eq(design.id, target.designId), eq(design.userId, userId)))
    .limit(1)
  if (!found) throw new Error(`Design "${target.designId}" not found`)
  if (found.canvasVersion !== CANVAS_SCHEMA_VERSION || !found.document) {
    throw new CanvasUnavailableError(target.designId)
  }
  return {
    id: found.id,
    name: found.name,
    draftId: null,
    draftName: null,
    status: 'active',
    document: parseCanvasDocument(found.document),
    revision: found.revision,
    updatedAt: found.updatedAt,
  }
}

async function applyCanvasTransactionsInternal(
  userId: string,
  target: CanvasTarget,
  transactions: CanvasTransaction[],
) {
  const parsed = transactions.map(parseCanvasTransaction)
  if (parsed.length === 0) throw new Error('At least one transaction is required')
  if (
    new Set(parsed.map((transaction) => transaction.id)).size !== parsed.length
  ) {
    throw new Error('A transaction batch cannot contain duplicate ids')
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const found = await getCanvasTarget(userId, target)
    if (found.status !== 'active') {
      throw new Error(`Draft "${target.draftId}" is read-only`)
    }
    const targetKey = target.draftId
      ? `draft:${target.draftId}`
      : 'main'
    const ids = parsed.map((transaction) => transaction.id)
    const existing = await db
      .select({ transactionId: canvasTransactionLog.transactionId })
      .from(canvasTransactionLog)
      .where(
        and(
          eq(canvasTransactionLog.userId, userId),
          eq(canvasTransactionLog.designId, target.designId),
          eq(canvasTransactionLog.targetKey, targetKey),
          inArray(canvasTransactionLog.transactionId, ids),
        ),
      )
    const seen = new Set(existing.map((row) => row.transactionId))
    const pending = parsed.filter((transaction) => !seen.has(transaction.id))
    if (pending.length === 0) {
      return {
        document: found.document,
        revision: found.revision,
        transactionIds: ids,
        changedNodeIds: [] as string[],
        idempotent: true,
      }
    }

    const engine = new CanvasEngine(found.document)
    const changed = new Set<string>()
    const applied: CanvasTransaction[] = []
    for (const transaction of pending) {
      const prepared = withTransactionPreconditions(
        engine.document,
        transaction,
      )
      const result = engine.apply(prepared, { recordHistory: false })
      applied.push(prepared)
      for (const id of result.changedNodeIds) changed.add(id)
    }
    const document = engine.document
    const now = new Date()
    const revision = found.revision + pending.length
    const committed = await db.transaction(async (tx) => {
      const updated = target.draftId
        ? await tx
            .update(designDraft)
            .set({
              canvasVersion: CANVAS_SCHEMA_VERSION,
              canvasDocument: document,
              revision,
              updatedAt: now,
            })
            .where(
              and(
                eq(designDraft.id, target.draftId),
                eq(designDraft.designId, target.designId),
                eq(designDraft.userId, userId),
                eq(designDraft.status, 'active'),
                eq(designDraft.revision, found.revision),
              ),
            )
            .returning({ revision: designDraft.revision })
        : await tx
            .update(design)
            .set({
              canvasVersion: CANVAS_SCHEMA_VERSION,
              canvasDocument: document,
              revision,
              updatedAt: now,
            })
            .where(
              and(
                eq(design.id, target.designId),
                eq(design.userId, userId),
                eq(design.revision, found.revision),
              ),
            )
            .returning({ revision: design.revision })
      if (!updated[0]) return false
      await tx
        .insert(canvasTransactionLog)
        .values(
          applied.map((transaction, index) => ({
            designId: target.designId,
            userId,
            targetKey,
            transactionId: transaction.id,
            baseRevision: found.revision + index,
            revision: found.revision + index + 1,
            transaction,
          })),
        )
        .onConflictDoNothing()
      const pruneBefore = canvasTransactionPruneBefore(
        found.revision,
        revision,
      )
      if (pruneBefore !== null) {
        await tx
          .delete(canvasTransactionLog)
          .where(
            and(
              eq(canvasTransactionLog.userId, userId),
              eq(canvasTransactionLog.designId, target.designId),
              eq(canvasTransactionLog.targetKey, targetKey),
              lt(canvasTransactionLog.revision, pruneBefore),
            ),
          )
      }
      return true
    })
    if (!committed) continue
    return {
      document,
      revision,
      transactionIds: ids,
      changedNodeIds: [...changed],
      idempotent: false,
    }
  }
  throw new Error('The canvas changed repeatedly; read it again before retrying.')
}

export async function applyCanvasTransactions(
  userId: string,
  target: CanvasTarget,
  transactions: CanvasTransaction[],
) {
  const result = await applyCanvasTransactionsInternal(
    userId,
    target,
    transactions.map(parseCanvasTransaction),
  )
  if (!result.idempotent) {
    void publishCanvasRealtimeEvent(userId, target, {
      type: 'canvas.changed',
      revision: result.revision,
      nodeIds: result.changedNodeIds,
    })
  }
  return result
}

export async function createDesign(userId: string, name: string, plan: LimitsPlan) {
  await requireDesignFileRoomForPlan(userId, plan)
  const id = newDesignId()
  const document = createCanvasDocument(name, id)
  const [created] = await db
    .insert(design)
    .values({
      id,
      userId,
      name,
      shapes: [],
      pages: [],
      canvasVersion: CANVAS_SCHEMA_VERSION,
      canvasDocument: document,
    })
    .returning({ id: design.id, name: design.name, revision: design.revision })
  return created
}

export async function renameDesign(userId: string, id: string, name: string) {
  const current = await getCanvasTarget(userId, { designId: id })
  const document: CanvasDocument = {
    ...current.document,
    name,
    metadata: {
      ...current.document.metadata,
      updatedAt: Date.now(),
    },
  }
  const [updated] = await db
    .update(design)
    .set({
      name,
      canvasVersion: CANVAS_SCHEMA_VERSION,
      canvasDocument: document,
      revision: current.revision + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(design.id, id),
        eq(design.userId, userId),
        eq(design.revision, current.revision),
      ),
    )
    .returning({
      id: design.id,
      name: design.name,
      revision: design.revision,
    })
  if (!updated) throw new Error(`Design "${id}" changed before it could be renamed`)
  return { ...updated, document }
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
      canvasVersion: designVersion.canvasVersion,
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
      canvasVersion: designDraft.canvasVersion,
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

export async function createDraft(
  userId: string,
  designId: string,
  name: string,
  plan: LimitsPlan,
) {
  await requireOpenBranchRoomForPlan(userId, designId, plan)
  const main = await getCanvasTarget(userId, { designId })
  const [created] = await db
    .insert(designDraft)
    .values({
      id: newDraftId(),
      designId,
      userId,
      name,
      baseShapes: [],
      shapes: [],
      basePages: [],
      pages: [],
      canvasVersion: CANVAS_SCHEMA_VERSION,
      baseCanvasVersion: CANVAS_SCHEMA_VERSION,
      baseCanvasDocument: main.document,
      canvasDocument: main.document,
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
          ? eq(designDraft.status, allowed[0]!)
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

async function draftMergeSource(userId: string, designId: string, draftId: string) {
  const [main, draft] = await Promise.all([
    getCanvasTarget(userId, { designId }),
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
  if (
    draft.canvasVersion !== CANVAS_SCHEMA_VERSION ||
    draft.baseCanvasVersion !== CANVAS_SCHEMA_VERSION ||
    !draft.canvasDocument ||
    !draft.baseCanvasDocument
  ) {
    throw new CanvasUnavailableError(designId)
  }
  return {
    main,
    draft,
    baseDocument: parseCanvasDocument(draft.baseCanvasDocument),
    draftDocument: parseCanvasDocument(draft.canvasDocument),
  }
}

type BranchMergeResolutions = Record<string, 'main' | 'draft'>

function canvasMergeResolutions(resolutions: BranchMergeResolutions) {
  return Object.fromEntries(
    Object.entries(resolutions).map(([id, side]) => [
      id,
      side === 'draft' ? 'right' : 'left',
    ]),
  ) as Record<string, 'left' | 'right'>
}

function branchMergeConflicts(conflicts: CanvasMergeConflict[]) {
  return conflicts.map(({ left, right, ...conflict }) => ({
    ...conflict,
    main: left,
    draft: right,
  }))
}

export async function compareDraft(userId: string, designId: string, draftId: string) {
  const source = await draftMergeSource(userId, designId, draftId)
  const merge = mergeDocuments(
    source.baseDocument,
    source.main.document,
    source.draftDocument,
  )
  return {
    designId,
    draftId,
    status: source.draft.status,
    mainRevision: source.main.revision,
    draftRevision: source.draft.revision,
    summary: merge.summary,
    conflicts: branchMergeConflicts(merge.conflicts),
  }
}

export async function applyDraft(
  userId: string,
  designId: string,
  draftId: string,
  expectedMainRevision: number,
  expectedDraftRevision: number,
  resolutions: BranchMergeResolutions,
) {
  const source = await draftMergeSource(userId, designId, draftId)
  if (
    source.main.revision !== expectedMainRevision ||
    source.draft.revision !== expectedDraftRevision
  ) {
    throw new Error('Main or the draft changed during review')
  }
  if (source.draft.status !== 'active' && source.draft.status !== 'proposed') {
    throw new Error(`Draft "${draftId}" is already archived`)
  }
  const merge = mergeDocuments(
    source.baseDocument,
    source.main.document,
    source.draftDocument,
    canvasMergeResolutions(resolutions),
  )
  if (merge.unresolved.length > 0) {
    return {
      applied: false as const,
      unresolved: merge.unresolved,
      conflicts: branchMergeConflicts(merge.conflicts),
    }
  }

  const beforeId = `v${crypto.randomUUID().replaceAll('-', '')}`
  const appliedId = `v${crypto.randomUUID().replaceAll('-', '')}`
  const now = new Date()
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(design)
      .set({
        canvasVersion: CANVAS_SCHEMA_VERSION,
        canvasDocument: merge.document,
        revision: source.main.revision + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(design.id, designId),
          eq(design.userId, userId),
          eq(design.revision, source.main.revision),
        ),
      )
      .returning({ id: design.id })
    if (!updated) throw new Error('Main changed while applying the draft')
    await tx.insert(designVersion).values([
      {
        id: beforeId,
        designId,
        userId,
        message: `Before applying: ${source.draft.name}`,
        shapes: [],
        pages: [],
        canvasVersion: CANVAS_SCHEMA_VERSION,
        canvasDocument: source.main.document,
        ...diffDocuments(createCanvasDocument(), source.main.document),
      },
      {
        id: appliedId,
        designId,
        userId,
        message: `Applied draft: ${source.draft.name}`,
        shapes: [],
        pages: [],
        canvasVersion: CANVAS_SCHEMA_VERSION,
        canvasDocument: merge.document,
        ...diffDocuments(source.main.document, merge.document),
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
          eq(designDraft.revision, source.draft.revision),
          or(eq(designDraft.status, 'active'), eq(designDraft.status, 'proposed')),
        ),
      )
      .returning({ id: designDraft.id })
    if (!archived) throw new Error('The draft changed while applying')
  })
  return {
    applied: true as const,
    revision: source.main.revision + 1,
    versionId: appliedId,
    document: merge.document,
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
