import { ORPCError } from '@orpc/server'
import {
  and,
  desc,
  eq,
  or,
} from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@loora/db'
import {
  design,
  designDraft,
  designVersion,
} from '@loora/db/schema'
import {
  CANVAS_SCHEMA_VERSION,
  createCanvasDocument,
  parseCanvasDocument,
} from '@loora/canvas/model'
import {
  changedNodeIds,
  diffDocuments,
  mergeDocuments,
  type CanvasMergeConflict,
  type CanvasMergeResolutions,
} from '@loora/canvas/merge'
import {
  mergeCanvas,
  type MergeChoice,
} from '@loora/db/drafts'
import {
  publishBranchChanged,
  publishCanvasRealtimeEvent,
} from '@loora/db/canvas-realtime'
import {
  documentDiff,
  draftIdSchema,
  ensureOpenBranchRoom,
  pageSchema,
  protectedProcedure,
  scheduleHistoryPrune,
  shapeSchema,
} from './procedures'

/**
 * The `draft` namespace — branches in the product: active, proposed, applied,
 * closed, and the merge that connects them.
 */

export async function getOwnedDraft(userId: string, designId: string, draftId: string) {
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

export type BranchMergeResolutions = Record<string, 'main' | 'draft'>

export function canvasMergeResolutions(
  resolutions: BranchMergeResolutions,
): CanvasMergeResolutions {
  return Object.fromEntries(
    Object.entries(resolutions).map(([id, side]) => [
      id,
      side === 'draft' ? 'right' : 'left',
    ]),
  )
}

export function branchMergeConflicts(conflicts: CanvasMergeConflict[]) {
  return conflicts.map(({ left, right, ...conflict }) => ({
    ...conflict,
    main: left,
    draft: right,
  }))
}

export async function getDraftComparison(userId: string, designId: string, draftId: string) {
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

export const listDrafts = protectedProcedure
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

export const createDraft = protectedProcedure
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

    void publishBranchChanged(context.user.id, input.designId, created.id, 'active')
    return {
      ...created,
      proposedAt: null,
      appliedAt: null,
      closedAt: null,
      createdAt: created.createdAt.getTime(),
      updatedAt: created.updatedAt.getTime(),
    }
  })

export const getDraft = protectedProcedure
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

export const saveDraft = protectedProcedure
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

export const renameDraft = protectedProcedure
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
    void publishBranchChanged(context.user.id, input.designId, updated.id, 'active')
    return updated
  })

export const proposeDraft = protectedProcedure
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
    void publishBranchChanged(context.user.id, input.designId, updated.id, 'proposed')
    return { ...updated, proposedAt: updated.proposedAt?.getTime() ?? null }
  })

export const reopenDraft = protectedProcedure
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
    void publishBranchChanged(context.user.id, input.designId, updated.id, 'active')
    return updated
  })

export const closeDraft = protectedProcedure
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
    void publishBranchChanged(context.user.id, input.designId, updated.id, 'closed')
    return { ...updated, closedAt: updated.closedAt?.getTime() ?? null }
  })

export const compareDraft = protectedProcedure
  .input(z.object({ designId: z.string().min(1).max(128), id: draftIdSchema }))
  .handler(({ context, input }) => getDraftComparison(context.user.id, input.designId, input.id))

export const applyDraft = protectedProcedure
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
    const newRevision = input.expectedMainRevision + 1
    const mergedNodeIds = documentMerge
      ? changedNodeIds(comparison.mainDocument!, documentMerge.document)
      : []
    void publishBranchChanged(context.user.id, input.designId, input.id, 'applied')
    void publishCanvasRealtimeEvent(context.user.id, { designId: input.designId }, {
      type: 'canvas.changed',
      revision: newRevision,
      nodeIds: mergedNodeIds,
    })
    return {
      applied: true as const,
      revision: newRevision,
      versionId: appliedId,
      canvasVersion: documentMerge ? CANVAS_SCHEMA_VERSION : comparison.canvasVersion,
      document: documentMerge?.document ?? null,
      shapes: legacyMerge?.shapes ?? comparison.mainShapes,
      pages: legacyMerge?.pages ?? comparison.mainPages,
      unresolved: [] as string[],
    }
  })
