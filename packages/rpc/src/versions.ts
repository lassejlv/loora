import { ORPCError } from '@orpc/server'
import {
  and,
  desc,
  eq,
  gte,
  isNotNull,
  lt,
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
import { diffDocuments } from '@loora/canvas/merge'
import {
  historyCutoffForCapacity,
  resolveHistoryCapacity,
} from '@loora/billing/enforce-plan-limits'
import { getOwnedDraft } from './branches'
import { canvasTargetInput } from './canvas-procedures'
import { sortCommitsOldestFirst, toHistoryPage } from './history'
import {
  documentDiff,
  draftTargetWhere,
  ensureDesign,
  ensureHistoryVersionAccessible,
  optionalDraftIdSchema,
  pageSchema,
  protectedProcedure,
  scheduleHistoryPrune,
  shapeSchema,
} from './procedures'

/**
 * The `history` namespace: committing, comparing and restoring versions.
 */

export const listVersions = protectedProcedure
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

export const compareVersion = protectedProcedure
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

export const importVersions = protectedProcedure
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

export const commitVersion = protectedProcedure
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

export const commitCanvasVersion = protectedProcedure
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

export const compareCanvasVersion = protectedProcedure
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

export const restoreCanvasVersion = protectedProcedure
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
