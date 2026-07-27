import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'
import { ORPCError, os } from '@orpc/server'
import { z } from 'zod'
import { db } from '@loora/db'
import {
  asset,
  canvasTransaction as canvasTransactionLog,
  design,
  designChat,
  designDraft,
  designGithubRepository,
  designVersion,
  oauthAccessToken,
  oauthApplication,
  oauthConsent,
  publishEgress,
  publishLink,
  user,
  userPreferences,
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
  createCanvasDocument,
  parseCanvasDocument,
  type CanvasDocumentV2,
} from '@loora/canvas/model'
import {
  diffDocuments,
  mergeDocuments,
  type CanvasMergeConflict,
  type CanvasMergeResolutions,
} from '@loora/canvas/merge'
import { EMPTY_SHORTCUT_CONFIG } from '@loora/db/shortcuts'
import { parseShortcutConfig, shortcutConfigSchema } from './shortcuts'
import { agentSystemPromptSchema } from './agent-prompt'
import { googleOAuthEnabled, type getSession } from '@loora/auth'
import { legacyArray, type CanvasElement, type CanvasPage } from '@loora/db/canvas'
import {
  mergeCanvas,
  type MergeChoice,
} from '@loora/db/drafts'
import { assetKey, s3 } from './storage'
import { createHandoffToken } from './handoff-token'
import {
  egressWindowCutoff,
  PUBLISH_EGRESS_LIMIT_BYTES,
  PUBLISH_EGRESS_WINDOW_DAYS,
  PUBLISH_TTL_MS,
  publishEgressUsed,
  publishLinkId,
  sweepPublishEgress,
} from './publish'
import {
  authorizeBilling,
  createPlanCheckout,
  getBillingStatus,
  refreshBillingStatus,
} from '@loora/billing/billing'
import { canUseApp, isPreviewAccessRequired } from '@loora/auth/preview-access'
import { completeTopUpCheckout, createTopUpCheckout } from '@loora/billing/credit-top-ups'
import { MAX_TOP_UP_CENTS, MIN_TOP_UP_CENTS } from '@loora/billing/top-up-policy'
import { sortCommitsOldestFirst, toHistoryPage } from './history'
import {
  DAILY_LIMIT_USD,
  WEEKLY_LIMIT_USD,
  getUsageStatus,
  listUserUsage,
  resetUsage,
} from '@loora/agent/usage'
import {
  disconnectGitHub,
  getGitHubStatus,
  githubEnabled,
  GitHubIntegrationError,
  listGitHubRepositories,
  syncGitHubInstallations,
} from '@loora/auth/github'
import { sanitizeChatMessagesForStorage } from './chat-storage'
import { summarizeMcpSessions } from './mcp-sessions'
import {
  disconnectFigma,
  FigmaIntegrationError,
  getFigmaStatus,
} from '@loora/auth/figma'
import {
  connectOpenRouter,
  disconnectOpenRouter,
  getOpenRouterStatus,
  OpenRouterIntegrationError,
} from '@loora/auth/openrouter'
import {
  AiProviderCredentialError,
  connectAiProvider,
  CUSTOM_AI_PROVIDERS,
  disconnectAiProvider,
  getAiProviderConnection,
  listAiProviderConnections,
} from '@loora/auth/ai-provider-credentials'
import { importFigmaDesign } from './figma-import'

type Session = Awaited<ReturnType<typeof getSession>>

export interface ORPCContext {
  session: Session
}

const shapeSchema = z.object({
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

const pageItemSchema = z.object({
  id: z.string().min(1).max(128),
  elementId: z.string().min(1).max(128),
  height: z.number().finite().min(1).max(100_000),
})

const pageSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(200),
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().min(1).max(100_000),
  items: z.array(pageItemSchema).max(10_000),
})

const draftIdSchema = z.string().min(1).max(128)
const optionalDraftIdSchema = draftIdSchema.nullish()
const draftTargetWhere = (draftId: string | null | undefined) =>
  draftId ? eq(designVersion.draftId, draftId) : isNull(designVersion.draftId)

const requireUser = os.$context<ORPCContext>().middleware(async ({ context, next }) => {
  if (!context.session) throw new ORPCError('UNAUTHORIZED')
  if (!canUseApp(context.session.user)) {
    throw new ORPCError('FORBIDDEN', { message: 'Preview access is required.' })
  }
  if (!(await authorizeBilling(context.session.user)).access) {
    throw new ORPCError('FORBIDDEN', { message: 'An active Loora plan is required.' })
  }
  return next({ context: { user: context.session.user } })
})

const protectedProcedure = os.$context<ORPCContext>().use(requireUser)

const requireSignedInUser = os.$context<ORPCContext>().middleware(async ({ context, next }) => {
  if (!context.session) throw new ORPCError('UNAUTHORIZED')
  return next({ context: { user: context.session.user } })
})

const signedInProcedure = os.$context<ORPCContext>().use(requireSignedInUser)

const requirePreviewUser = os.$context<ORPCContext>().middleware(async ({ context, next }) => {
  if (!context.session) throw new ORPCError('UNAUTHORIZED')
  if (!canUseApp(context.session.user)) {
    throw new ORPCError('FORBIDDEN', { message: 'Preview access is required.' })
  }
  return next({ context: { user: context.session.user } })
})

const previewProcedure = os.$context<ORPCContext>().use(requirePreviewUser)

const requireAdmin = os.$context<ORPCContext>().middleware(async ({ context, next }) => {
  if (!context.session) throw new ORPCError('UNAUTHORIZED')
  if (!context.session.user.isAdmin) throw new ORPCError('FORBIDDEN')
  return next({ context: { user: context.session.user } })
})

const adminProcedure = os.$context<ORPCContext>().use(requireAdmin)

function collectionDiff<T extends { id: string }>(previous: T[], next: T[]) {
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

function documentDiff(
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
async function ensureDesign(designId: string, userId: string) {
  await db
    .insert(design)
    .values({ id: designId, userId, name: 'Untitled', shapes: [], pages: [] })
    .onConflictDoNothing({ target: [design.id, design.userId] })
}

const listDesigns = protectedProcedure.handler(async ({ context }) => {
  return db
    .select({
      id: design.id,
      name: design.name,
      revision: design.revision,
      updatedAt: design.updatedAt,
    })
    .from(design)
    .where(eq(design.userId, context.user.id))
    .orderBy(asc(design.createdAt))
    .then((rows) => rows.map(({ updatedAt, ...row }) => ({ ...row, updatedAt: updatedAt.getTime() })))
})

const getDesign = protectedProcedure
  .input(z.object({ id: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const [found] = await db
      .select({
        id: design.id,
        name: design.name,
        shapes: design.shapes,
        pages: design.pages,
        revision: design.revision,
        updatedAt: design.updatedAt,
      })
      .from(design)
      .where(and(eq(design.id, input.id), eq(design.userId, context.user.id)))
      .limit(1)

    if (!found) throw new ORPCError('NOT_FOUND')
    return { ...found, updatedAt: found.updatedAt.getTime() }
  })

const saveDesign = protectedProcedure
  .input(
    z.object({
      id: z.string().min(1).max(128),
      name: z.string().trim().min(1).max(200),
      shapes: z.array(shapeSchema).max(10_000),
      pages: z.array(pageSchema).max(1_000).default([]),
      expectedRevision: z.number().int().nonnegative().optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    const { expectedRevision, ...values } = input
    const [existing] = await db
      .select({ revision: design.revision })
      .from(design)
      .where(and(eq(design.id, input.id), eq(design.userId, context.user.id)))
      .limit(1)

    if (!existing) {
      const [created] = await db
        .insert(design)
        .values({ ...values, userId: context.user.id })
        .returning({
          id: design.id,
          revision: design.revision,
          updatedAt: design.updatedAt,
        })
      return { ...created, updatedAt: created.updatedAt.getTime() }
    }

    if (expectedRevision !== undefined && expectedRevision !== existing.revision) {
      throw new ORPCError('CONFLICT', { message: 'Main changed since it was loaded.' })
    }

    const [saved] = await db
      .update(design)
      .set({
        name: input.name,
        shapes: input.shapes,
        pages: input.pages,
        revision: existing.revision + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(design.id, input.id),
          eq(design.userId, context.user.id),
          eq(design.revision, existing.revision),
        ),
      )
      .returning({
        id: design.id,
        revision: design.revision,
        updatedAt: design.updatedAt,
      })

    if (!saved) throw new ORPCError('CONFLICT', { message: 'Main changed while it was saving.' })
    return { ...saved, updatedAt: saved.updatedAt.getTime() }
  })

const deleteDesign = protectedProcedure
  .input(z.object({ id: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const deleted = await db
      .delete(design)
      .where(and(eq(design.id, input.id), eq(design.userId, context.user.id)))
      .returning({ id: design.id })

    return { deleted: deleted.length > 0 }
  })

const canvasTargetKey = (draftId: string | null | undefined) =>
  draftId ? `draft:${draftId}` : 'main'

const canvasTargetInput = z.object({
  designId: z.string().min(1).max(128),
  draftId: optionalDraftIdSchema,
})

const createCanvasDesign = protectedProcedure
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
      throw new ORPCError('CONFLICT', { message: 'MIGRATION_REQUIRED' })
    }
    return {
      created: false as const,
      id: existing.id,
      revision: existing.revision,
      document: parseCanvasDocument(existing.document),
    }
  })

const renameCanvasDesign = protectedProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      name: z.string().trim().min(1).max(200),
      expectedRevision: z.number().int().nonnegative(),
    }),
  )
  .handler(async ({ context, input }) => {
    const [target] = await db
      .select({
        document: design.canvasDocument,
        version: design.canvasVersion,
        revision: design.revision,
      })
      .from(design)
      .where(and(eq(design.id, input.designId), eq(design.userId, context.user.id)))
      .limit(1)
    if (!target) throw new ORPCError('NOT_FOUND')
    if (target.version !== CANVAS_SCHEMA_VERSION || !target.document) {
      throw new ORPCError('CONFLICT', { message: 'MIGRATION_REQUIRED' })
    }
    if (target.revision !== input.expectedRevision) {
      throw new ORPCError('CONFLICT', {
        message: 'Main changed before it could be renamed.',
      })
    }
    const document = parseCanvasDocument(target.document)
    const renamedDocument: CanvasDocumentV2 = {
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
          eq(design.userId, context.user.id),
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

async function canvasInterveningTransactions(
  userId: string,
  designId: string,
  draftId: string | null | undefined,
  revision: number,
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
      ),
    )
    .orderBy(asc(canvasTransactionLog.revision))
    .limit(101)
}

const getCanvas = protectedProcedure
  .input(
    canvasTargetInput.extend({
      sinceRevision: z.number().int().nonnegative().optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    const target = input.draftId
      ? await db
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
              eq(designDraft.userId, context.user.id),
            ),
          )
          .limit(1)
          .then((rows) => rows[0])
      : await db
          .select({
            version: design.canvasVersion,
            document: design.canvasDocument,
            revision: design.revision,
          })
          .from(design)
          .where(and(eq(design.id, input.designId), eq(design.userId, context.user.id)))
          .limit(1)
          .then((rows) => rows[0])
    if (!target) throw new ORPCError('NOT_FOUND')
    if (target.version !== CANVAS_SCHEMA_VERSION || !target.document) {
      return {
        status: 'migration-required' as const,
        version: target.version,
        revision: target.revision,
        openPath: `/app/design?id=${encodeURIComponent(input.designId)}&migrate=canvas-v2`,
      }
    }
    const document = parseCanvasDocument(target.document)
    if (
      input.sinceRevision === undefined ||
      input.sinceRevision === target.revision
    ) {
      return {
        status: 'ready' as const,
        version: CANVAS_SCHEMA_VERSION,
        revision: target.revision,
        document,
        transactions: [] as CanvasTransaction[],
      }
    }
    const intervening = await canvasInterveningTransactions(
      context.user.id,
      input.designId,
      input.draftId,
      input.sinceRevision,
    )
    const complete =
      intervening.length <= 100 &&
      intervening[0]?.revision === input.sinceRevision + 1 &&
      intervening.at(-1)?.revision === target.revision
    return {
      status: 'ready' as const,
      version: CANVAS_SCHEMA_VERSION,
      revision: target.revision,
      document: complete ? null : document,
      transactions: complete
        ? intervening.map((entry) => parseCanvasTransaction(entry.transaction))
        : [],
    }
  })

const applyCanvasTransactions = protectedProcedure
  .input(
    canvasTargetInput.extend({
      expectedRevision: z.number().int().nonnegative(),
      transactions: z.array(z.unknown()).min(1).max(100),
    }),
  )
  .handler(async ({ context, input }) => {
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
            eq(canvasTransactionLog.userId, context.user.id),
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

    return db.transaction(async (tx) => {
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
                eq(designDraft.userId, context.user.id),
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
            .where(and(eq(design.id, input.designId), eq(design.userId, context.user.id)))
            .limit(1)
            .then((rows) => rows[0])
      if (!target) throw new ORPCError('NOT_FOUND')
      if (target.version !== CANVAS_SCHEMA_VERSION || !target.document) {
        throw new ORPCError('CONFLICT', { message: 'MIGRATION_REQUIRED' })
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
          changedNodeIds: [] as string[],
        }
      }
      if (target.revision !== input.expectedRevision) {
        const intervening = await canvasInterveningTransactions(
          context.user.id,
          input.designId,
          input.draftId,
          input.expectedRevision,
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
      let nextDocument: CanvasDocumentV2 = document
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
                eq(designDraft.userId, context.user.id),
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
                eq(design.userId, context.user.id),
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
                  eq(designDraft.userId, context.user.id),
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
                  eq(design.userId, context.user.id),
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
            userId: context.user.id,
            targetKey: canvasTargetKey(input.draftId),
            transactionId: transaction.id,
            baseRevision: target.revision + index,
            revision: target.revision + index + 1,
            transaction,
          })),
        )
        await tx
          .delete(canvasTransactionLog)
          .where(
            and(
              eq(canvasTransactionLog.userId, context.user.id),
              eq(canvasTransactionLog.designId, input.designId),
              eq(canvasTransactionLog.targetKey, canvasTargetKey(input.draftId)),
              lt(canvasTransactionLog.revision, Math.max(0, nextRevision - 500)),
            ),
          )
      }
      return {
        applied: true as const,
        idempotent: freshTransactions.length === 0,
        revision: nextRevision,
        document: nextDocument,
        transactionIds: transactions.map((transaction) => transaction.id),
        changedNodeIds: [...changedNodeIds],
      }
    })
  })

const beginCanvasMigration = protectedProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      leaseId: z.string().min(16).max(200),
    }),
  )
  .handler(async ({ context, input }) => {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 2 * 60_000)
    const [leased] = await db
      .update(design)
      .set({
        canvasMigrationLeaseId: input.leaseId,
        canvasMigrationLeaseExpiresAt: expiresAt,
      })
      .where(
        and(
          eq(design.id, input.designId),
          eq(design.userId, context.user.id),
          or(
            isNull(design.canvasMigrationLeaseId),
            lt(design.canvasMigrationLeaseExpiresAt, now),
            eq(design.canvasMigrationLeaseId, input.leaseId),
          ),
        ),
      )
      .returning({
        id: design.id,
        name: design.name,
        canvasVersion: design.canvasVersion,
        canvasDocument: design.canvasDocument,
        shapes: design.shapes,
        pages: design.pages,
        revision: design.revision,
      })
    if (!leased) {
      const [current] = await db
        .select({
          leaseId: design.canvasMigrationLeaseId,
          expiresAt: design.canvasMigrationLeaseExpiresAt,
        })
        .from(design)
        .where(and(eq(design.id, input.designId), eq(design.userId, context.user.id)))
        .limit(1)
      if (!current) throw new ORPCError('NOT_FOUND')
      return {
        acquired: false as const,
        retryAt: current.expiresAt?.getTime() ?? now.getTime() + 1_000,
      }
    }
    if (
      leased.canvasVersion === CANVAS_SCHEMA_VERSION &&
      leased.canvasDocument
    ) {
      await db
        .update(design)
        .set({ canvasMigrationLeaseId: null, canvasMigrationLeaseExpiresAt: null })
        .where(
          and(
            eq(design.id, input.designId),
            eq(design.userId, context.user.id),
            eq(design.canvasMigrationLeaseId, input.leaseId),
          ),
        )
      return {
        acquired: true as const,
        alreadyMigrated: true as const,
        revision: leased.revision,
        document: parseCanvasDocument(leased.canvasDocument),
      }
    }
    const drafts = await db
      .select({
        id: designDraft.id,
        name: designDraft.name,
        revision: designDraft.revision,
        baseRevision: designDraft.baseRevision,
        shapes: designDraft.shapes,
        pages: designDraft.pages,
        baseShapes: designDraft.baseShapes,
        basePages: designDraft.basePages,
      })
      .from(designDraft)
      .where(
        and(
          eq(designDraft.designId, input.designId),
          eq(designDraft.userId, context.user.id),
          or(eq(designDraft.status, 'active'), eq(designDraft.status, 'proposed')),
        ),
      )
    return {
      acquired: true as const,
      alreadyMigrated: false as const,
      leaseExpiresAt: expiresAt.getTime(),
      main: {
        id: leased.id,
        name: leased.name,
        revision: leased.revision,
        shapes: legacyArray<CanvasElement>(leased.shapes),
        pages: legacyArray<CanvasPage>(leased.pages),
      },
      drafts: drafts.map((draft) => ({
        ...draft,
        shapes: legacyArray<CanvasElement>(draft.shapes),
        pages: legacyArray<CanvasPage>(draft.pages),
        baseShapes: legacyArray<CanvasElement>(draft.baseShapes),
        basePages: legacyArray<CanvasPage>(draft.basePages),
      })),
    }
  })

const renewCanvasMigration = protectedProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      leaseId: z.string().min(16).max(200),
    }),
  )
  .handler(async ({ context, input }) => {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 2 * 60_000)
    const [renewed] = await db
      .update(design)
      .set({ canvasMigrationLeaseExpiresAt: expiresAt })
      .where(
        and(
          eq(design.id, input.designId),
          eq(design.userId, context.user.id),
          eq(design.canvasMigrationLeaseId, input.leaseId),
          gt(design.canvasMigrationLeaseExpiresAt, now),
        ),
      )
      .returning({ id: design.id })
    if (!renewed) {
      throw new ORPCError('CONFLICT', {
        message: 'The Canvas migration lease expired.',
      })
    }
    return { renewed: true as const, expiresAt: expiresAt.getTime() }
  })

const cancelCanvasMigration = protectedProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      leaseId: z.string().min(16).max(200),
    }),
  )
  .handler(async ({ context, input }) => {
    const [cancelled] = await db
      .update(design)
      .set({
        canvasMigrationLeaseId: null,
        canvasMigrationLeaseExpiresAt: null,
      })
      .where(
        and(
          eq(design.id, input.designId),
          eq(design.userId, context.user.id),
          eq(design.canvasMigrationLeaseId, input.leaseId),
        ),
      )
      .returning({ id: design.id })
    return { cancelled: cancelled !== undefined }
  })

const commitCanvasMigration = protectedProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      leaseId: z.string().min(16).max(200),
      sourceRevision: z.number().int().nonnegative(),
      document: z.unknown(),
      drafts: z.array(z.object({
        id: draftIdSchema,
        sourceRevision: z.number().int().nonnegative(),
        document: z.unknown(),
        baseDocument: z.unknown(),
      })).max(100),
    }),
  )
  .handler(async ({ context, input }) => {
    const mainDocument = parseCanvasDocument(input.document)
    const drafts = input.drafts.map((draft) => ({
      ...draft,
      document: parseCanvasDocument(draft.document),
      baseDocument: parseCanvasDocument(draft.baseDocument),
    }))
    const now = new Date()
    return db.transaction(async (tx) => {
      for (const draft of drafts) {
        const [updated] = await tx
          .update(designDraft)
          .set({
            canvasVersion: CANVAS_SCHEMA_VERSION,
            baseCanvasVersion: CANVAS_SCHEMA_VERSION,
            canvasDocument: draft.document,
            baseCanvasDocument: draft.baseDocument,
            revision: draft.sourceRevision + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(designDraft.id, draft.id),
              eq(designDraft.designId, input.designId),
              eq(designDraft.userId, context.user.id),
              eq(designDraft.revision, draft.sourceRevision),
              or(eq(designDraft.status, 'active'), eq(designDraft.status, 'proposed')),
            ),
          )
          .returning({ id: designDraft.id })
        if (!updated) {
          throw new ORPCError('CONFLICT', {
            message: `Draft ${draft.id} changed during migration.`,
          })
        }
      }
      const [updatedMain] = await tx
        .update(design)
        .set({
          canvasVersion: CANVAS_SCHEMA_VERSION,
          canvasDocument: mainDocument,
          canvasMigrationLeaseId: null,
          canvasMigrationLeaseExpiresAt: null,
          revision: input.sourceRevision + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(design.id, input.designId),
            eq(design.userId, context.user.id),
            eq(design.revision, input.sourceRevision),
            eq(design.canvasMigrationLeaseId, input.leaseId),
            gt(design.canvasMigrationLeaseExpiresAt, now),
          ),
        )
        .returning({ id: design.id })
      if (!updatedMain) {
        throw new ORPCError('CONFLICT', {
          message: 'Main changed or the migration lease expired.',
        })
      }
      return {
        committed: true as const,
        revision: input.sourceRevision + 1,
        draftRevisions: Object.fromEntries(
          drafts.map((draft) => [draft.id, draft.sourceRevision + 1]),
        ),
      }
    })
  })

async function getOwnedDraft(userId: string, designId: string, draftId: string) {
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

type BranchMergeResolutions = Record<string, 'main' | 'draft'>

function canvasMergeResolutions(
  resolutions: BranchMergeResolutions,
): CanvasMergeResolutions {
  return Object.fromEntries(
    Object.entries(resolutions).map(([id, side]) => [
      id,
      side === 'draft' ? 'right' : 'left',
    ]),
  )
}

function branchMergeConflicts(conflicts: CanvasMergeConflict[]) {
  return conflicts.map(({ left, right, ...conflict }) => ({
    ...conflict,
    main: left,
    draft: right,
  }))
}

async function getDraftComparison(userId: string, designId: string, draftId: string) {
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
  const usesV2 =
    main.canvasVersion === CANVAS_SCHEMA_VERSION &&
    draft.canvasVersion === CANVAS_SCHEMA_VERSION &&
    draft.baseCanvasVersion === CANVAS_SCHEMA_VERSION &&
    !!main.canvasDocument &&
    !!draft.canvasDocument &&
    !!draft.baseCanvasDocument
  const v2Merge = usesV2
    ? mergeDocuments(
        parseCanvasDocument(draft.baseCanvasDocument),
        parseCanvasDocument(main.canvasDocument),
        parseCanvasDocument(draft.canvasDocument),
      )
    : null
  const legacyMerge = usesV2
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
    canvasVersion: usesV2 ? CANVAS_SCHEMA_VERSION : 1,
    mainDocument: usesV2 ? parseCanvasDocument(main.canvasDocument) : null,
    draftDocument: usesV2 ? parseCanvasDocument(draft.canvasDocument) : null,
    baseDocument: usesV2 ? parseCanvasDocument(draft.baseCanvasDocument) : null,
    mainShapes: main.shapes,
    draftShapes: draft.shapes,
    baseShapes: draft.baseShapes,
    mainPages: main.pages,
    draftPages: draft.pages,
    basePages: draft.basePages,
    summary: v2Merge?.summary ?? legacyMerge!.summary,
    conflicts: v2Merge
      ? branchMergeConflicts(v2Merge.conflicts)
      : legacyMerge!.conflicts,
    unresolved: v2Merge?.unresolved ?? legacyMerge!.unresolved,
  }
}

const listDrafts = protectedProcedure
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

const createDraft = protectedProcedure
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

    return {
      ...created,
      proposedAt: null,
      appliedAt: null,
      closedAt: null,
      createdAt: created.createdAt.getTime(),
      updatedAt: created.updatedAt.getTime(),
    }
  })

const getDraft = protectedProcedure
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

const saveDraft = protectedProcedure
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

const renameDraft = protectedProcedure
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
    return updated
  })

const proposeDraft = protectedProcedure
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
    return { ...updated, proposedAt: updated.proposedAt?.getTime() ?? null }
  })

const reopenDraft = protectedProcedure
  .input(z.object({ designId: z.string().min(1).max(128), id: draftIdSchema }))
  .handler(async ({ context, input }) => {
    const [updated] = await db
      .update(designDraft)
      .set({ status: 'active', proposedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(designDraft.id, input.id),
          eq(designDraft.designId, input.designId),
          eq(designDraft.userId, context.user.id),
          eq(designDraft.status, 'proposed'),
        ),
      )
      .returning({ id: designDraft.id, status: designDraft.status })
    if (!updated) throw new ORPCError('CONFLICT', { message: 'Only proposed drafts can be reopened.' })
    return updated
  })

const closeDraft = protectedProcedure
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
    return { ...updated, closedAt: updated.closedAt?.getTime() ?? null }
  })

const compareDraft = protectedProcedure
  .input(z.object({ designId: z.string().min(1).max(128), id: draftIdSchema }))
  .handler(({ context, input }) => getDraftComparison(context.user.id, input.designId, input.id))

const applyDraft = protectedProcedure
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

    const v2Merge =
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
    const legacyMerge = v2Merge
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
    const unresolved = v2Merge?.unresolved ?? legacyMerge!.unresolved
    const conflicts = v2Merge
      ? branchMergeConflicts(v2Merge.conflicts)
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
          canvasVersion: v2Merge ? CANVAS_SCHEMA_VERSION : comparison.canvasVersion,
          canvasDocument: v2Merge?.document ?? comparison.mainDocument,
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
          ...(v2Merge
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
          canvasVersion: v2Merge ? CANVAS_SCHEMA_VERSION : comparison.canvasVersion,
          canvasDocument: v2Merge?.document ?? comparison.mainDocument,
          ...(v2Merge
            ? diffDocuments(comparison.mainDocument!, v2Merge.document)
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

    return {
      applied: true as const,
      revision: input.expectedMainRevision + 1,
      versionId: appliedId,
      canvasVersion: v2Merge ? CANVAS_SCHEMA_VERSION : comparison.canvasVersion,
      document: v2Merge?.document ?? null,
      shapes: legacyMerge?.shapes ?? comparison.mainShapes,
      pages: legacyMerge?.pages ?? comparison.mainPages,
      unresolved: [] as string[],
    }
  })

const createDesignHandoff = protectedProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      draftId: optionalDraftIdSchema,
    }),
  )
  .handler(async ({ context, input }) => {
    const [found] = await db
      .select({ id: design.id })
      .from(design)
      .where(and(eq(design.id, input.designId), eq(design.userId, context.user.id)))
      .limit(1)
    if (!found) throw new ORPCError('NOT_FOUND')
    if (input.draftId) {
      await getOwnedDraft(context.user.id, input.designId, input.draftId)
    }
    return createHandoffToken(input.designId, context.user.id, undefined, input.draftId)
  })

// Live public link to one element or Page: the row id is the URL capability, deleting
// the row revokes it. Content stays live — the public route reads the design
// at request time.
const createPublishLink = protectedProcedure
  .input(
    z
      .object({
        designId: z.string().min(1).max(128),
        elementId: z.string().min(1).max(128).optional(),
        pageId: z.string().min(1).max(128).optional(),
      })
      .refine((value) => Boolean(value.elementId) !== Boolean(value.pageId), {
        message: 'Choose exactly one publish target.',
      }),
  )
  .handler(async ({ context, input }) => {
    const [found] = await db
      .select({
        canvasVersion: design.canvasVersion,
        canvasDocument: design.canvasDocument,
        shapes: design.shapes,
        pages: design.pages,
      })
      .from(design)
      .where(and(eq(design.id, input.designId), eq(design.userId, context.user.id)))
      .limit(1)
    const shapesById = new Map(found?.shapes.map((shape) => [shape.id, shape]) ?? [])
    const targetExists =
      found &&
      (found.canvasVersion === CANVAS_SCHEMA_VERSION && found.canvasDocument
        ? (() => {
            if (!input.pageId || input.elementId) return false
            const document = parseCanvasDocument(found.canvasDocument)
            const page = document.nodes[input.pageId]
            return page?.type === 'page' && !page.hidden
          })()
        : input.elementId
          ? (() => {
              const shape = shapesById.get(input.elementId)
              return Boolean(shape && !shape.hidden && shape.code)
            })()
          : (() => {
              const page = found.pages.find((candidate) => candidate.id === input.pageId)
              return Boolean(
                page &&
                  page.items.length > 0 &&
                  page.items.every(({ elementId }) => {
                    const shape = shapesById.get(elementId)
                    return shape && !shape.hidden && shape.code
                  }),
              )
            })())
    if (!targetExists) {
      throw new ORPCError('NOT_FOUND')
    }

    // Lazy cleanup: publishing sweeps this user's expired links and stale
    // egress counter rows.
    await db
      .delete(publishLink)
      .where(and(eq(publishLink.userId, context.user.id), lt(publishLink.expiresAt, new Date())))
    await sweepPublishEgress(context.user.id)

    const expiresAt = new Date(Date.now() + PUBLISH_TTL_MS)

    // Publishing the same target twice extends the link that is already out
    // there rather than minting a second capability URL for it. A link that
    // was explicitly unpublished is gone, so it never comes back this way.
    const [live] = await db
      .select({ id: publishLink.id })
      .from(publishLink)
      .where(
        and(
          eq(publishLink.userId, context.user.id),
          eq(publishLink.designId, input.designId),
          input.pageId
            ? eq(publishLink.pageId, input.pageId)
            : eq(publishLink.elementId, input.elementId!),
        ),
      )
      .limit(1)
    if (live) {
      await db
        .update(publishLink)
        .set({ expiresAt })
        .where(and(eq(publishLink.id, live.id), eq(publishLink.userId, context.user.id)))
      return { id: live.id, expiresAt: expiresAt.getTime() }
    }

    const id = publishLinkId()
    await db.insert(publishLink).values({
      id,
      designId: input.designId,
      userId: context.user.id,
      elementId: input.elementId ?? null,
      pageId: input.pageId ?? null,
      expiresAt,
    })
    return { id, expiresAt: expiresAt.getTime() }
  })

const deletePublishLink = protectedProcedure
  .input(z.object({ id: z.string().min(1).max(64) }))
  .handler(async ({ context, input }) => {
    const deleted = await db
      .delete(publishLink)
      .where(and(eq(publishLink.id, input.id), eq(publishLink.userId, context.user.id)))
      .returning({ id: publishLink.id })
    return { deleted: deleted.length > 0 }
  })

const listPublishLinks = protectedProcedure
  .input(z.object({ designId: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const rows = await db
      .select({
        id: publishLink.id,
        elementId: publishLink.elementId,
        pageId: publishLink.pageId,
        expiresAt: publishLink.expiresAt,
      })
      .from(publishLink)
      .where(
        and(
          eq(publishLink.userId, context.user.id),
          eq(publishLink.designId, input.designId),
          gt(publishLink.expiresAt, new Date()),
        ),
      )
    return rows.map((row) => ({ ...row, expiresAt: row.expiresAt.getTime() }))
  })

const getPublishEgress = protectedProcedure.handler(async ({ context }) => {
  return {
    usedBytes: await publishEgressUsed(context.user.id),
    limitBytes: PUBLISH_EGRESS_LIMIT_BYTES,
    windowDays: PUBLISH_EGRESS_WINDOW_DAYS,
    unlimited: context.user.isAdmin === true,
  }
})

// All of a user's live links across designs (settings panel). The element
// name is extracted in SQL so the full shapes JSONB never leaves the database.
const listAllPublishLinks = protectedProcedure.handler(async ({ context }) => {
  const rows = await db
    .select({
      id: publishLink.id,
      designId: publishLink.designId,
      elementId: publishLink.elementId,
      pageId: publishLink.pageId,
      expiresAt: publishLink.expiresAt,
      designName: design.name,
      elementName: sql<string | null>`(
        select elem->>'name' from jsonb_array_elements(${design.shapes}) elem
        where elem->>'id' = ${publishLink.elementId} limit 1
      )`,
      pageName: sql<string | null>`(
        select page->>'name' from jsonb_array_elements(${design.pages}) page
        where page->>'id' = ${publishLink.pageId} limit 1
      )`,
    })
    .from(publishLink)
    .innerJoin(
      design,
      and(eq(design.id, publishLink.designId), eq(design.userId, publishLink.userId)),
    )
    .where(and(eq(publishLink.userId, context.user.id), gt(publishLink.expiresAt, new Date())))
    .orderBy(desc(publishLink.createdAt))
  return rows.map((row) => ({ ...row, expiresAt: row.expiresAt.getTime() }))
})

const listVersions = protectedProcedure
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

const getCanvasVersionForMigration = protectedProcedure
  .input(
    canvasTargetInput.extend({
      id: z.string().min(1).max(128),
    }),
  )
  .handler(async ({ context, input }) => {
    const [version] = await db
      .select({
        message: designVersion.message,
        canvasVersion: designVersion.canvasVersion,
        document: designVersion.canvasDocument,
        shapes: designVersion.shapes,
        pages: designVersion.pages,
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
    if (!version) throw new ORPCError('NOT_FOUND')
    if (
      version.canvasVersion === CANVAS_SCHEMA_VERSION &&
      version.document
    ) {
      return {
        status: 'ready' as const,
        document: parseCanvasDocument(version.document),
      }
    }
    return {
      status: 'migration-required' as const,
      name: version.message,
      shapes: legacyArray<CanvasElement>(version.shapes),
      pages: legacyArray<CanvasPage>(version.pages),
    }
  })

const commitCanvasVersionMigration = protectedProcedure
  .input(
    canvasTargetInput.extend({
      id: z.string().min(1).max(128),
      document: z.unknown(),
    }),
  )
  .handler(async ({ context, input }) => {
    const document = parseCanvasDocument(input.document)
    const [migrated] = await db
      .update(designVersion)
      .set({
        canvasVersion: CANVAS_SCHEMA_VERSION,
        canvasDocument: document,
      })
      .where(
        and(
          eq(designVersion.id, input.id),
          eq(designVersion.designId, input.designId),
          eq(designVersion.userId, context.user.id),
          draftTargetWhere(input.draftId),
          eq(designVersion.canvasVersion, 1),
        ),
      )
      .returning({ id: designVersion.id })
    if (!migrated) {
      const [current] = await db
        .select({
          canvasVersion: designVersion.canvasVersion,
          document: designVersion.canvasDocument,
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
        current?.canvasVersion !== CANVAS_SCHEMA_VERSION ||
        !current.document
      ) {
        throw new ORPCError('CONFLICT', {
          message: 'The historical version could not be migrated.',
        })
      }
      return {
        migrated: false as const,
        document: parseCanvasDocument(current.document),
      }
    }
    return { migrated: true as const, document }
  })

const compareVersion = protectedProcedure
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

const importVersions = protectedProcedure
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
    await ensureDesign(input.designId, context.user.id)
    if (input.draftId) {
      const draft = await getOwnedDraft(context.user.id, input.designId, input.draftId)
      if (draft.status !== 'active') {
        throw new ORPCError('CONFLICT', { message: 'This draft is read-only.' })
      }
    }
    // Sequential inside one transaction: the bun-sql driver has no batch(), and a
    // single connection can't run these in parallel anyway.
    await db.transaction(async (tx) => {
      for (const commit of sortCommitsOldestFirst(input.commits)) {
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
      }
    })
    return { processed: input.commits.length }
  })

const commitVersion = protectedProcedure
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
    await ensureDesign(input.designId, context.user.id)
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

    return {
      id: version.id,
      message: version.message,
      added: version.added,
      removed: version.removed,
      changed: version.changed,
      at: version.createdAt.getTime(),
    }
  })

const commitCanvasVersion = protectedProcedure
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
      await ensureDesign(input.designId, context.user.id)
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
    return {
      id: version.id,
      message: version.message,
      added: version.added,
      removed: version.removed,
      changed: version.changed,
      at: version.createdAt.getTime(),
    }
  })

const compareCanvasVersion = protectedProcedure
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

const restoreCanvasVersion = protectedProcedure
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

const listChats = protectedProcedure
  .input(z.object({ designId: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const chats = await db
      .select({
        id: designChat.id,
        draftId: designChat.draftId,
        title: designChat.title,
        githubRepositoryId: designChat.githubRepositoryId,
        githubRepositoryFullName: designChat.githubRepositoryFullName,
        updatedAt: designChat.updatedAt,
      })
      .from(designChat)
      .where(
        and(eq(designChat.designId, input.designId), eq(designChat.userId, context.user.id)),
      )
      .orderBy(desc(designChat.updatedAt))

    return chats.map(({ updatedAt, ...chat }) => ({ ...chat, updatedAt: updatedAt.getTime() }))
  })

const createChat = protectedProcedure
  .input(
    z.object({
      id: z.string().min(1).max(128),
      designId: z.string().min(1).max(128),
      draftId: optionalDraftIdSchema,
      title: z.string().trim().min(1).max(200).default('New chat'),
    }),
  )
  .handler(async ({ context, input }) => {
    await ensureDesign(input.designId, context.user.id)
    if (input.draftId) {
      const draft = await getOwnedDraft(context.user.id, input.designId, input.draftId)
      if (draft.status !== 'active') {
        throw new ORPCError('CONFLICT', { message: 'Chats can only start on active drafts.' })
      }
    }
    const [repository] = await db
      .select({
        id: designGithubRepository.repositoryId,
        fullName: designGithubRepository.owner,
        name: designGithubRepository.name,
      })
      .from(designGithubRepository)
      .where(
        and(
          eq(designGithubRepository.designId, input.designId),
          eq(designGithubRepository.userId, context.user.id),
        ),
      )
      .limit(1)
    const [chat] = await db
      .insert(designChat)
      .values({
        ...input,
        draftId: input.draftId ?? null,
        userId: context.user.id,
        messages: [],
        githubRepositoryId: repository?.id ?? null,
        githubRepositoryFullName: repository
          ? `${repository.fullName}/${repository.name}`
          : null,
      })
      .onConflictDoNothing({ target: [designChat.id, designChat.userId] })
      .returning({
        id: designChat.id,
        draftId: designChat.draftId,
        title: designChat.title,
        githubRepositoryId: designChat.githubRepositoryId,
        githubRepositoryFullName: designChat.githubRepositoryFullName,
        updatedAt: designChat.updatedAt,
      })

    if (chat) return { ...chat, updatedAt: chat.updatedAt.getTime() }

    const [existing] = await db
      .select({
        id: designChat.id,
        draftId: designChat.draftId,
        title: designChat.title,
        githubRepositoryId: designChat.githubRepositoryId,
        githubRepositoryFullName: designChat.githubRepositoryFullName,
        updatedAt: designChat.updatedAt,
      })
      .from(designChat)
      .where(and(eq(designChat.id, input.id), eq(designChat.userId, context.user.id)))
      .limit(1)

    if (!existing) throw new ORPCError('INTERNAL_SERVER_ERROR')
    return { ...existing, updatedAt: existing.updatedAt.getTime() }
  })

const getChat = protectedProcedure
  .input(z.object({ id: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const [chat] = await db
      .select({ messages: designChat.messages })
      .from(designChat)
      .where(and(eq(designChat.id, input.id), eq(designChat.userId, context.user.id)))
      .limit(1)

    if (!chat) throw new ORPCError('NOT_FOUND')
    return { messages: chat.messages }
  })

const saveChat = protectedProcedure
  .input(
    z.object({
      id: z.string().min(1).max(128),
      title: z.string().trim().min(1).max(200),
      messages: z.array(z.unknown()).max(1_000),
    }),
  )
  .handler(async ({ context, input }) => {
    const saved = await db
      .update(designChat)
      .set({
        title: input.title,
        messages: sanitizeChatMessagesForStorage(input.messages),
        updatedAt: new Date(),
      })
      .where(and(eq(designChat.id, input.id), eq(designChat.userId, context.user.id)))
      .returning({ id: designChat.id })

    if (saved.length === 0) throw new ORPCError('NOT_FOUND')
    return { saved: input.messages.length }
  })

const deleteChat = protectedProcedure
  .input(z.object({ id: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const deleted = await db
      .delete(designChat)
      .where(and(eq(designChat.id, input.id), eq(designChat.userId, context.user.id)))
      .returning({ id: designChat.id })

    return { deleted: deleted.length > 0 }
  })

const MAX_ASSET_BYTES = 5 * 1024 * 1024

const listAssets = protectedProcedure.handler(async ({ context }) => {
  const assets = await db
    .select({
      id: asset.id,
      name: asset.name,
      mediaType: asset.mediaType,
      size: asset.size,
      createdAt: asset.createdAt,
    })
    .from(asset)
    .where(eq(asset.userId, context.user.id))
    .orderBy(desc(asset.createdAt))

  return assets.map(({ createdAt, ...a }) => ({ ...a, at: createdAt.getTime() }))
})

const uploadAsset = protectedProcedure
  .input(
    z.object({
      name: z.string().trim().min(1).max(200),
      mediaType: z.string().regex(/^image\/[\w.+-]+$/),
      data: z.string().min(1), // base64, no data: prefix
    }),
  )
  .handler(async ({ context, input }) => {
    const bytes = Buffer.from(input.data, 'base64')
    if (bytes.length > MAX_ASSET_BYTES) {
      throw new ORPCError('PAYLOAD_TOO_LARGE', { message: 'Assets are capped at 5MB.' })
    }
    const id = `a${crypto.randomUUID().replaceAll('-', '')}`

    let storageKey: string | null = null
    if (s3) {
      storageKey = assetKey(context.user.id, id)
      await s3.write(storageKey, bytes, { type: input.mediaType })
    }

    const [saved] = await db
      .insert(asset)
      .values({
        id,
        userId: context.user.id,
        name: input.name,
        mediaType: input.mediaType,
        size: bytes.length,
        storageKey,
        data: storageKey ? null : input.data,
      })
      .returning({ id: asset.id, name: asset.name, mediaType: asset.mediaType, size: asset.size })

    return saved
  })

const deleteAsset = protectedProcedure
  .input(z.object({ id: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const deleted = await db
      .delete(asset)
      .where(and(eq(asset.id, input.id), eq(asset.userId, context.user.id)))
      .returning({ id: asset.id, storageKey: asset.storageKey })

    const key = deleted[0]?.storageKey
    if (key && s3) {
      await s3.delete(key).catch((error) => console.error('[assets] S3 delete failed:', error))
    }
    return { deleted: deleted.length > 0 }
  })

const getCurrentUsage = protectedProcedure.handler(({ context }) =>
  getUsageStatus(context.user.id),
)

function githubProcedureError(error: unknown): never {
  if (error instanceof GitHubIntegrationError) {
    if (error.code === 'RECONNECT_REQUIRED') {
      throw new ORPCError('UNAUTHORIZED', { message: error.message })
    }
    if (error.code === 'ACCESS_DENIED') {
      throw new ORPCError('FORBIDDEN', { message: error.message })
    }
    if (error.code === 'RATE_LIMITED') {
      throw new ORPCError('TOO_MANY_REQUESTS', { message: error.message })
    }
    throw new ORPCError('BAD_REQUEST', { message: error.message })
  }
  throw error
}

function figmaProcedureError(error: unknown): never {
  if (error instanceof FigmaIntegrationError) {
    if (error.code === 'RECONNECT_REQUIRED') {
      throw new ORPCError('UNAUTHORIZED', { message: error.message })
    }
    if (error.code === 'ACCESS_DENIED') {
      throw new ORPCError('FORBIDDEN', { message: error.message })
    }
    if (error.code === 'RATE_LIMITED') {
      throw new ORPCError('TOO_MANY_REQUESTS', { message: error.message })
    }
    if (error.code === 'TOO_LARGE') {
      throw new ORPCError('PAYLOAD_TOO_LARGE', { message: error.message })
    }
    if (error.code === 'INVALID_FILE' || error.code === 'NOT_CONFIGURED') {
      throw new ORPCError('BAD_REQUEST', { message: error.message })
    }
    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: error.message })
  }
  throw error
}

function openRouterProcedureError(error: unknown): never {
  if (error instanceof OpenRouterIntegrationError) {
    if (error.code === 'RECONNECT_REQUIRED') {
      throw new ORPCError('UNAUTHORIZED', { message: error.message })
    }
    if (error.code === 'RATE_LIMITED') {
      throw new ORPCError('TOO_MANY_REQUESTS', { message: error.message })
    }
    if (error.code === 'INVALID_KEY') {
      throw new ORPCError('BAD_REQUEST', { message: error.message })
    }
    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: error.message })
  }
  throw error
}

function aiProviderProcedureError(error: unknown): never {
  if (error instanceof AiProviderCredentialError) {
    if (error.code === 'RECONNECT_REQUIRED') {
      throw new ORPCError('UNAUTHORIZED', { message: error.message })
    }
    if (error.code === 'RATE_LIMITED') {
      throw new ORPCError('TOO_MANY_REQUESTS', { message: error.message })
    }
    if (error.code === 'INVALID_KEY') {
      throw new ORPCError('BAD_REQUEST', { message: error.message })
    }
    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: error.message })
  }
  throw error
}

const customAiProviderSchema = z.enum(CUSTOM_AI_PROVIDERS)

const listCustomAiProviderConnections = protectedProcedure.handler(
  async ({ context }) => {
    try {
      return await listAiProviderConnections(context.user.id)
    } catch (error) {
      return aiProviderProcedureError(error)
    }
  },
)

const getCustomAiProviderConnection = protectedProcedure
  .input(z.object({ provider: customAiProviderSchema }))
  .handler(async ({ context, input }) => {
    try {
      return await getAiProviderConnection(context.user.id, input.provider)
    } catch (error) {
      return aiProviderProcedureError(error)
    }
  })

const connectCustomAiProvider = protectedProcedure
  .input(
    z.object({
      provider: customAiProviderSchema,
      apiKey: z.string().trim().min(10).max(512),
    }),
  )
  .handler(async ({ context, input }) => {
    try {
      return await connectAiProvider(context.user.id, input.provider, input.apiKey)
    } catch (error) {
      return aiProviderProcedureError(error)
    }
  })

const disconnectCustomAiProvider = protectedProcedure
  .input(z.object({ provider: customAiProviderSchema }))
  .handler(async ({ context, input }) => {
    try {
      return await disconnectAiProvider(context.user.id, input.provider)
    } catch (error) {
      return aiProviderProcedureError(error)
    }
  })

const getOpenRouterConnection = protectedProcedure.handler(async ({ context }) => {
  try {
    return await getOpenRouterStatus(context.user.id)
  } catch (error) {
    return openRouterProcedureError(error)
  }
})

const connectOpenRouterAccount = protectedProcedure
  .input(
    z.object({
      apiKey: z.string().trim().min(10).max(512),
    }),
  )
  .handler(async ({ context, input }) => {
    try {
      return await connectOpenRouter(context.user.id, input.apiKey)
    } catch (error) {
      return openRouterProcedureError(error)
    }
  })

const disconnectOpenRouterAccount = protectedProcedure.handler(async ({ context }) => {
  try {
    return await disconnectOpenRouter(context.user.id)
  } catch (error) {
    return openRouterProcedureError(error)
  }
})

const getFigmaConnection = protectedProcedure.handler(async ({ context }) => {
  try {
    return await getFigmaStatus(context.user.id)
  } catch (error) {
    return figmaProcedureError(error)
  }
})

const importFigma = protectedProcedure
  .input(
    z.object({
      url: z.string().trim().min(1).max(2_000),
      target: z
        .object({
          id: z.string().min(1).max(128),
          name: z.string().trim().min(1).max(200),
          draftId: optionalDraftIdSchema,
          revision: z.number().int().nonnegative(),
        })
        .optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    try {
      return await importFigmaDesign(context.user.id, input.url, input.target)
    } catch (error) {
      return figmaProcedureError(error)
    }
  })

const disconnectFigmaAccount = protectedProcedure.handler(async ({ context }) => {
  try {
    return await disconnectFigma(context.user.id)
  } catch (error) {
    return figmaProcedureError(error)
  }
})

const getGithubStatus = protectedProcedure.handler(async ({ context }) => {
  try {
    return await getGitHubStatus(context.user.id)
  } catch (error) {
    return githubProcedureError(error)
  }
})

const listGithubRepositories = protectedProcedure.handler(async ({ context }) => {
  try {
    return await listGitHubRepositories(context.user.id)
  } catch (error) {
    return githubProcedureError(error)
  }
})

const refreshGithub = protectedProcedure.handler(async ({ context }) => {
  try {
    await syncGitHubInstallations(context.user.id)
    return await listGitHubRepositories(context.user.id)
  } catch (error) {
    return githubProcedureError(error)
  }
})

const getDesignGithubRepository = protectedProcedure
  .input(z.object({ designId: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const [repository] = await db
      .select({
        installationId: designGithubRepository.installationId,
        id: designGithubRepository.repositoryId,
        owner: designGithubRepository.owner,
        name: designGithubRepository.name,
        defaultBranch: designGithubRepository.defaultBranch,
      })
      .from(designGithubRepository)
      .where(
        and(
          eq(designGithubRepository.designId, input.designId),
          eq(designGithubRepository.userId, context.user.id),
        ),
      )
      .limit(1)
    return repository ? { ...repository, fullName: `${repository.owner}/${repository.name}` } : null
  })

const bindDesignGithubRepository = protectedProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      installationId: z.string().min(1).max(64),
      repositoryId: z.string().min(1).max(64),
    }),
  )
  .handler(async ({ context, input }) => {
    const [ownedDesign] = await db
      .select({ id: design.id })
      .from(design)
      .where(and(eq(design.id, input.designId), eq(design.userId, context.user.id)))
      .limit(1)
    if (!ownedDesign) throw new ORPCError('NOT_FOUND')

    try {
      const repositories = await listGitHubRepositories(context.user.id)
      const repository = repositories.find(
        (candidate) =>
          candidate.installationId === input.installationId &&
          candidate.id === input.repositoryId,
      )
      if (!repository) throw new ORPCError('FORBIDDEN', { message: 'Repository access was not granted.' })
      await db
        .insert(designGithubRepository)
        .values({
          designId: input.designId,
          userId: context.user.id,
          installationId: repository.installationId,
          repositoryId: repository.id,
          owner: repository.owner,
          name: repository.name,
          defaultBranch: repository.defaultBranch,
        })
        .onConflictDoUpdate({
          target: [designGithubRepository.designId, designGithubRepository.userId],
          set: {
            installationId: repository.installationId,
            repositoryId: repository.id,
            owner: repository.owner,
            name: repository.name,
            defaultBranch: repository.defaultBranch,
            updatedAt: new Date(),
          },
        })
      return {
        installationId: repository.installationId,
        id: repository.id,
        owner: repository.owner,
        name: repository.name,
        fullName: repository.fullName,
        defaultBranch: repository.defaultBranch,
      }
    } catch (error) {
      return githubProcedureError(error)
    }
  })

const clearDesignGithubRepository = protectedProcedure
  .input(z.object({ designId: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const deleted = await db
      .delete(designGithubRepository)
      .where(
        and(
          eq(designGithubRepository.designId, input.designId),
          eq(designGithubRepository.userId, context.user.id),
        ),
      )
      .returning({ id: designGithubRepository.repositoryId })
    return { cleared: deleted.length > 0 }
  })

const disconnectGithub = protectedProcedure.handler(async ({ context }) => {
  try {
    return await disconnectGitHub(context.user.id)
  } catch (error) {
    return githubProcedureError(error)
  }
})

const listMcpSessions = signedInProcedure.handler(async ({ context }) => {
  const rows = await db
    .select({
      clientId: oauthAccessToken.clientId,
      clientName: oauthApplication.name,
      createdAt: oauthAccessToken.createdAt,
      updatedAt: oauthAccessToken.updatedAt,
      accessTokenExpiresAt: oauthAccessToken.accessTokenExpiresAt,
      refreshTokenExpiresAt: oauthAccessToken.refreshTokenExpiresAt,
    })
    .from(oauthAccessToken)
    .leftJoin(oauthApplication, eq(oauthAccessToken.clientId, oauthApplication.clientId))
    .where(
      and(
        eq(oauthAccessToken.userId, context.user.id),
        isNotNull(oauthAccessToken.clientId),
      ),
    )
    .orderBy(desc(oauthAccessToken.updatedAt))

  return summarizeMcpSessions(rows)
})

const revokeMcpSession = signedInProcedure
  .input(z.object({ clientId: z.string().min(1).max(256) }))
  .handler(async ({ context, input }) => {
    const [tokens, consents] = await Promise.all([
      db
        .delete(oauthAccessToken)
        .where(
          and(
            eq(oauthAccessToken.userId, context.user.id),
            eq(oauthAccessToken.clientId, input.clientId),
          ),
        )
        .returning({ id: oauthAccessToken.id }),
      db
        .delete(oauthConsent)
        .where(
          and(
            eq(oauthConsent.userId, context.user.id),
            eq(oauthConsent.clientId, input.clientId),
          ),
        )
        .returning({ id: oauthConsent.id }),
    ])

    return { revoked: tokens.length > 0 || consents.length > 0 }
  })

const getAuthConfig = os.handler(() => ({ googleOAuthEnabled, githubEnabled }))

const getPreviewAccess = signedInProcedure.handler(async ({ context }) => {
  const [account] = await db
    .select({
      isAdmin: user.isAdmin,
      previewAccess: user.previewAccess,
      previewAccessRequestedAt: user.previewAccessRequestedAt,
    })
    .from(user)
    .where(eq(user.id, context.user.id))
    .limit(1)

  if (!account) throw new ORPCError('UNAUTHORIZED')
  const required = isPreviewAccessRequired()
  return {
    required,
    granted: canUseApp(account, required),
    requested: account.previewAccessRequestedAt !== null,
  }
})

const requestPreviewAccess = signedInProcedure.handler(async ({ context }) => {
  if (!isPreviewAccessRequired() || canUseApp(context.user)) {
    return { requested: false, granted: true }
  }

  await db
    .update(user)
    .set({ previewAccessRequestedAt: new Date(), updatedAt: new Date() })
    .where(eq(user.id, context.user.id))

  return { requested: true, granted: false }
})

async function deleteUserAccountData(userId: string) {
  // S3 objects don't cascade with the user row; collect and delete them first.
  if (s3) {
    const keys = await db
      .select({ storageKey: asset.storageKey })
      .from(asset)
      .where(and(eq(asset.userId, userId), isNotNull(asset.storageKey)))
    for (const { storageKey } of keys) {
      if (storageKey) {
        await s3
          .delete(storageKey)
          .catch((error) => console.error('[account] S3 delete failed:', error))
      }
    }
  }

  // Everything else (designs, chats, sessions, oauth tokens, usage) cascades.
  await db.delete(user).where(eq(user.id, userId))
}

const deleteAccount = signedInProcedure.handler(async ({ context }) => {
  await deleteUserAccountData(context.user.id)
  return { deleted: true }
})

const getCurrentBilling = previewProcedure.handler(({ context }) =>
  getBillingStatus(context.user),
)

const refreshCurrentBilling = previewProcedure.handler(({ context }) =>
  refreshBillingStatus(context.user),
)

const createSubscriptionCheckout = previewProcedure
  .input(z.object({ plan: z.enum(['pro', 'studio']) }))
  .handler(async ({ context, input }) => {
    const billing = await authorizeBilling(context.user)
    if (billing.access) {
      throw new ORPCError('FORBIDDEN', {
        message: 'Manage your existing subscription from Billing.',
      })
    }
    return createPlanCheckout(context.user, input.plan)
  })

const createCreditTopUp = protectedProcedure
  .input(z.object({
    amountCents: z.number().int().min(MIN_TOP_UP_CENTS).max(MAX_TOP_UP_CENTS),
  }))
  .handler(async ({ context, input }) => {
    const billing = await authorizeBilling(context.user)
    if (!billing.topUpAccess) {
      throw new ORPCError('FORBIDDEN', {
        message: 'Credit top-ups become available after the Pro trial.',
      })
    }
    return createTopUpCheckout(context.user, input.amountCents)
  })

const completeCreditTopUp = previewProcedure
  .input(z.object({ checkoutId: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const order = await completeTopUpCheckout(context.user.id, input.checkoutId)
    return {
      completed: order !== null,
      addedCredits: order?.creditUnits ?? 0,
      billing: await getBillingStatus(context.user),
    }
  })

const listUsersWithUsage = adminProcedure.handler(async () => {
  // Separate grouped query instead of a second join in listUserUsage — joining
  // aiUsage and publishEgress together would cross-product both sums.
  const [accounts, egress] = await Promise.all([
    listUserUsage(),
    db
      .select({
        userId: publishEgress.userId,
        total: sql<string>`sum(${publishEgress.bytes})`,
      })
      .from(publishEgress)
      .where(gte(publishEgress.day, egressWindowCutoff()))
      .groupBy(publishEgress.userId),
  ])
  const egressByUser = new Map(egress.map((row) => [row.userId, Number(row.total)]))
  return accounts.map((account) => ({
    ...account,
    publishEgressBytes: egressByUser.get(account.id) ?? 0,
    publishEgressLimitBytes: PUBLISH_EGRESS_LIMIT_BYTES,
  }))
})

const resetUserUsage = adminProcedure
  .input(z.object({ userId: z.string().min(1).max(128) }))
  .handler(async ({ input }) => ({ deleted: await resetUsage(input.userId) }))

const setUserUsageMultiplier = adminProcedure
  .input(
    z.object({
      userId: z.string().min(1).max(128),
      multiplier: z.number().int().min(1).max(1_000_000),
    }),
  )
  .handler(async ({ input }) => {
    const [updated] = await db
      .update(user)
      .set({ usageMultiplier: input.multiplier, updatedAt: new Date() })
      .where(eq(user.id, input.userId))
      .returning({ userId: user.id, usageMultiplier: user.usageMultiplier })

    if (!updated) throw new ORPCError('NOT_FOUND')
    return {
      ...updated,
      dailyLimitUsd: DAILY_LIMIT_USD * updated.usageMultiplier,
      weeklyLimitUsd: WEEKLY_LIMIT_USD * updated.usageMultiplier,
    }
  })

const setUserPreviewAccess = adminProcedure
  .input(
    z.object({
      userId: z.string().min(1).max(128),
      granted: z.boolean(),
    }),
  )
  .handler(async ({ input }) => {
    const [updated] = await db
      .update(user)
      .set({
        previewAccess: input.granted,
        previewAccessRequestedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(user.id, input.userId))
      .returning({ userId: user.id, previewAccess: user.previewAccess })

    if (!updated) throw new ORPCError('NOT_FOUND')
    return updated
  })

const deleteUserAccount = adminProcedure
  .input(
    z.object({
      userId: z.string().min(1).max(128),
      email: z.string().trim().email().max(320),
    }),
  )
  .handler(async ({ context, input }) => {
    if (input.userId === context.user.id) {
      throw new ORPCError('FORBIDDEN', {
        message: 'You cannot delete your own account from Admin.',
      })
    }

    const [target] = await db
      .select({ id: user.id, email: user.email, isAdmin: user.isAdmin })
      .from(user)
      .where(eq(user.id, input.userId))
      .limit(1)
    if (!target) throw new ORPCError('NOT_FOUND')
    if (target.isAdmin) {
      throw new ORPCError('FORBIDDEN', {
        message: 'Admin accounts cannot be deleted.',
      })
    }
    if (target.email !== input.email) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'Email confirmation does not match.',
      })
    }

    await deleteUserAccountData(target.id)
    return { deleted: true }
  })

const getPreferences = protectedProcedure.handler(async ({ context }) => {
  const [row] = await db
    .select({
      shortcuts: userPreferences.shortcuts,
      agentSystemPrompt: userPreferences.agentSystemPrompt,
    })
    .from(userPreferences)
    .where(eq(userPreferences.userId, context.user.id))
    .limit(1)
  return {
    shortcuts: row ? parseShortcutConfig(row.shortcuts) : { ...EMPTY_SHORTCUT_CONFIG, custom: [] },
    agentSystemPrompt: row?.agentSystemPrompt ?? '',
  }
})

const savePreferences = protectedProcedure
  .input(z.object({ shortcuts: shortcutConfigSchema }))
  .handler(async ({ context, input }) => {
    const shortcuts = parseShortcutConfig(input.shortcuts)
    await db
      .insert(userPreferences)
      .values({
        userId: context.user.id,
        shortcuts,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: {
          shortcuts,
          updatedAt: new Date(),
        },
      })
    return { shortcuts }
  })

const saveAgentPrompt = protectedProcedure
  .input(z.object({ prompt: agentSystemPromptSchema }))
  .handler(async ({ context, input }) => {
    const agentSystemPrompt = input.prompt
    await db
      .insert(userPreferences)
      .values({
        userId: context.user.id,
        agentSystemPrompt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: {
          agentSystemPrompt,
          updatedAt: new Date(),
        },
      })
    return { agentSystemPrompt }
  })

export const appRouter = {
  auth: {
    config: getAuthConfig,
    previewAccess: getPreviewAccess,
    requestPreviewAccess,
    deleteAccount,
  },
  preferences: {
    get: getPreferences,
    save: savePreferences,
    saveAgentPrompt,
  },
  billing: {
    status: getCurrentBilling,
    refresh: refreshCurrentBilling,
    checkout: createSubscriptionCheckout,
    createTopUp: createCreditTopUp,
    completeTopUp: completeCreditTopUp,
  },
  design: {
    list: listDesigns,
    get: getDesign,
    save: saveDesign,
    delete: deleteDesign,
  },
  canvas: {
    create: createCanvasDesign,
    get: getCanvas,
    rename: renameCanvasDesign,
    applyTransactions: applyCanvasTransactions,
    beginMigration: beginCanvasMigration,
    renewMigration: renewCanvasMigration,
    cancelMigration: cancelCanvasMigration,
    commitMigration: commitCanvasMigration,
  },
  draft: {
    list: listDrafts,
    create: createDraft,
    get: getDraft,
    save: saveDraft,
    rename: renameDraft,
    propose: proposeDraft,
    reopen: reopenDraft,
    compare: compareDraft,
    apply: applyDraft,
    close: closeDraft,
  },
  handoff: {
    create: createDesignHandoff,
  },
  publish: {
    create: createPublishLink,
    delete: deletePublishLink,
    list: listPublishLinks,
    listAll: listAllPublishLinks,
    egress: getPublishEgress,
  },
  history: {
    list: listVersions,
    compare: compareVersion,
    import: importVersions,
    commit: commitVersion,
    commitV2: commitCanvasVersion,
    compareV2: compareCanvasVersion,
    getForMigration: getCanvasVersionForMigration,
    commitMigration: commitCanvasVersionMigration,
    restoreV2: restoreCanvasVersion,
  },
  chat: {
    list: listChats,
    create: createChat,
    get: getChat,
    save: saveChat,
    delete: deleteChat,
  },
  asset: {
    list: listAssets,
    upload: uploadAsset,
    delete: deleteAsset,
  },
  usage: {
    get: getCurrentUsage,
  },
  github: {
    status: getGithubStatus,
    repositories: listGithubRepositories,
    refresh: refreshGithub,
    binding: getDesignGithubRepository,
    bind: bindDesignGithubRepository,
    clear: clearDesignGithubRepository,
    disconnect: disconnectGithub,
  },
  figma: {
    status: getFigmaConnection,
    import: importFigma,
    disconnect: disconnectFigmaAccount,
  },
  openrouter: {
    status: getOpenRouterConnection,
    connect: connectOpenRouterAccount,
    disconnect: disconnectOpenRouterAccount,
  },
  aiProvider: {
    list: listCustomAiProviderConnections,
    status: getCustomAiProviderConnection,
    connect: connectCustomAiProvider,
    disconnect: disconnectCustomAiProvider,
  },
  mcp: {
    sessions: listMcpSessions,
    revoke: revokeMcpSession,
  },
  admin: {
    listUsers: listUsersWithUsage,
    resetUsage: resetUserUsage,
    setUsageMultiplier: setUserUsageMultiplier,
    setPreviewAccess: setUserPreviewAccess,
    deleteUser: deleteUserAccount,
  },
}
