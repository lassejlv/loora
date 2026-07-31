import { ORPCError } from '@orpc/server'
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  lt,
  lte,
} from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@loora/db'
import {
  canvasTransaction as canvasTransactionLog,
  design,
  designDraft,
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
  parseCanvasDocument,
  type CanvasDocument,
} from '@loora/canvas/model'
import {
  publishCanvasRealtimeEvent,
  readCanvasAgentActivity,
} from '@loora/db/canvas-realtime'
import { canvasTransactionPruneBefore } from '@loora/db/canvas-transactions'
import {
  consentedProcedure,
  ensureDesignFileRoom,
  optionalDraftIdSchema,
  protectedProcedure,
  requireDesignAccess,
} from './procedures'

/**
 * The `canvas` namespace: creating a document and moving it forward one
 * validated transaction batch at a time.
 */

export const canvasTargetKey = (draftId: string | null | undefined) =>
  draftId ? `draft:${draftId}` : 'main'

export const canvasTargetInput = z.object({
  designId: z.string().min(1).max(128),
  draftId: optionalDraftIdSchema,
})

export const createCanvasDesign = protectedProcedure
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

export const renameCanvasDesign = consentedProcedure
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

export async function canvasInterveningTransactions(
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

export async function canvasTargetSnapshot(
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

export const getCanvas = consentedProcedure
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

export const applyCanvasTransactions = consentedProcedure
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
