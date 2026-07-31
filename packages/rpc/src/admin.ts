import { ORPCError } from '@orpc/server'
import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  max,
  or,
  sql,
  sum,
} from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@loora/db'
import {
  asset,
  billingEntitlement,
  design,
  designDraft,
  designShare,
  designVersion,
  oauthAccessToken,
  oauthConsent,
  session as authSession,
  user,
} from '@loora/db/schema'
import { refreshEntitlement } from '@loora/billing/billing'
import { adminProcedure } from './procedures'
import { deleteUserAccountData } from './account'

/**
 * The `admin` namespace: the whole workspace, for staff accounts only.
 */

export const DAY_MS = 24 * 60 * 60 * 1000

export function toCount(value: unknown) {
  const n = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
}

/** Escape LIKE wildcards so a search for `%` matches a literal percent sign. */
export function likeTerm(search: string) {
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

export const adminOverview = adminProcedure.handler(async () => {
  const now = new Date()
  const last7Days = new Date(now.getTime() - 7 * DAY_MS)
  const last24Hours = new Date(now.getTime() - DAY_MS)

  const [
    [users],
    [newUsers],
    [designs],
    [newDesigns],
    [openBranches],
    [assets],
    [activeSessions],
    [mcpClients],
    [versions],
  ] = await Promise.all([
    db
      .select({
        total: count(),
        admins: sum(sql<number>`case when ${user.isAdmin} then 1 else 0 end`),
        previewGranted: sum(
          sql<number>`case when ${user.previewAccess} then 1 else 0 end`,
        ),
        pending: sum(
          sql<number>`case when ${user.previewAccessRequestedAt} is not null
            and not ${user.previewAccess} then 1 else 0 end`,
        ),
      })
      .from(user),
    db.select({ n: count() }).from(user).where(gte(user.createdAt, last7Days)),
    db.select({ n: count() }).from(design),
    db
      .select({ n: count() })
      .from(design)
      .where(gte(design.createdAt, last7Days)),
    db
      .select({ n: count() })
      .from(designDraft)
      .where(
        or(eq(designDraft.status, 'active'), eq(designDraft.status, 'proposed')),
      ),
    db.select({ n: count(), bytes: sum(asset.size) }).from(asset),
    db
      .select({ n: countDistinct(authSession.userId) })
      .from(authSession)
      .where(
        and(
          gt(authSession.expiresAt, now),
          gte(authSession.updatedAt, last24Hours),
        ),
      ),
    db
      .select({
        clients: countDistinct(oauthAccessToken.clientId),
        users: countDistinct(oauthAccessToken.userId),
      })
      .from(oauthAccessToken)
      .where(isNotNull(oauthAccessToken.clientId)),
    db
      .select({ n: count() })
      .from(designVersion)
      .where(gte(designVersion.createdAt, last7Days)),
  ])

  return {
    generatedAt: now.toISOString(),
    users: {
      total: toCount(users?.total),
      newLast7Days: toCount(newUsers?.n),
      admins: toCount(users?.admins),
      previewGranted: toCount(users?.previewGranted),
      pendingPreviewRequests: toCount(users?.pending),
      activeLast24Hours: toCount(activeSessions?.n),
    },
    designs: {
      total: toCount(designs?.n),
      newLast7Days: toCount(newDesigns?.n),
      openBranches: toCount(openBranches?.n),
      versionsLast7Days: toCount(versions?.n),
    },
    storage: {
      assets: toCount(assets?.n),
      bytes: toCount(assets?.bytes),
    },
    mcp: {
      connectedClients: toCount(mcpClients?.clients),
      connectedUsers: toCount(mcpClients?.users),
    },
  }
})

export const ADMIN_USER_FILTERS = ['all', 'pending', 'admins', 'paid'] as const

/**
 * One row per account with the usage the other admin actions act on. The
 * aggregates are grouped queries merged in memory rather than correlated
 * subqueries per row: the account table is small, and this keeps the shape
 * readable while staying a fixed number of round-trips.
 */
export const listUsersWithUsage = adminProcedure
  .input(
    z
      .object({
        search: z.string().trim().max(320).optional(),
        filter: z.enum(ADMIN_USER_FILTERS).default('all'),
        limit: z.number().int().min(1).max(500).default(200),
      })
      .default({ filter: 'all', limit: 200 }),
  )
  .handler(async ({ input }) => {
    const search = input.search?.trim()
    const conditions = [
      search
        ? or(
            ilike(user.email, likeTerm(search)),
            ilike(user.name, likeTerm(search)),
          )
        : undefined,
      input.filter === 'admins' ? eq(user.isAdmin, true) : undefined,
      input.filter === 'pending'
        ? and(
            isNotNull(user.previewAccessRequestedAt),
            eq(user.previewAccess, false),
          )
        : undefined,
    ].filter(Boolean)

    const rows = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
        previewAccess: user.previewAccess,
        previewAccessRequestedAt: user.previewAccessRequestedAt,
        createdAt: user.createdAt,
      })
      .from(user)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(user.email))
      .limit(input.limit)

    const ids = rows.map((row) => row.id)
    if (ids.length === 0) return []

    const [designRows, assetRows, branchRows, sessionRows, entitlementRows, mcpRows] =
      await Promise.all([
        db
          .select({
            userId: design.userId,
            designs: count(),
            lastDesignAt: max(design.updatedAt),
          })
          .from(design)
          .where(inArray(design.userId, ids))
          .groupBy(design.userId),
        db
          .select({ userId: asset.userId, assets: count(), bytes: sum(asset.size) })
          .from(asset)
          .where(inArray(asset.userId, ids))
          .groupBy(asset.userId),
        db
          .select({ userId: designDraft.userId, openBranches: count() })
          .from(designDraft)
          .where(
            and(
              inArray(designDraft.userId, ids),
              or(
                eq(designDraft.status, 'active'),
                eq(designDraft.status, 'proposed'),
              ),
            ),
          )
          .groupBy(designDraft.userId),
        db
          .select({ userId: authSession.userId, lastSeenAt: max(authSession.updatedAt) })
          .from(authSession)
          .where(inArray(authSession.userId, ids))
          .groupBy(authSession.userId),
        db
          .select({
            userId: billingEntitlement.userId,
            plan: billingEntitlement.plan,
            subscriptionStatus: billingEntitlement.subscriptionStatus,
            accessGranted: billingEntitlement.accessGranted,
            cancelAtPeriodEnd: billingEntitlement.cancelAtPeriodEnd,
            currentPeriodEnd: billingEntitlement.currentPeriodEnd,
          })
          .from(billingEntitlement)
          .where(inArray(billingEntitlement.userId, ids)),
        db
          .select({
            userId: oauthAccessToken.userId,
            clients: countDistinct(oauthAccessToken.clientId),
          })
          .from(oauthAccessToken)
          .where(
            and(
              inArray(oauthAccessToken.userId, ids),
              isNotNull(oauthAccessToken.clientId),
            ),
          )
          .groupBy(oauthAccessToken.userId),
      ])

    const byUser = <T extends { userId: string }>(list: T[]) =>
      new Map(list.map((row) => [row.userId, row]))
    const designsBy = byUser(designRows)
    const assetsBy = byUser(assetRows)
    const branchesBy = byUser(branchRows)
    const sessionsBy = byUser(sessionRows)
    const entitlementsBy = byUser(entitlementRows)
    // `oauth_access_token.user_id` is nullable (client-credentials grants).
    const mcpBy = new Map(
      mcpRows.flatMap((row) => (row.userId ? [[row.userId, row.clients] as const] : [])),
    )

    const users = rows.map((row) => {
      const entitlement = entitlementsBy.get(row.id) ?? null
      return {
        ...row,
        designs: toCount(designsBy.get(row.id)?.designs),
        lastDesignAt: designsBy.get(row.id)?.lastDesignAt ?? null,
        assets: toCount(assetsBy.get(row.id)?.assets),
        storageBytes: toCount(assetsBy.get(row.id)?.bytes),
        openBranches: toCount(branchesBy.get(row.id)?.openBranches),
        lastSeenAt: sessionsBy.get(row.id)?.lastSeenAt ?? null,
        mcpClients: toCount(mcpBy.get(row.id)),
        plan: row.isAdmin ? 'admin' : (entitlement?.plan ?? null),
        subscriptionStatus: entitlement?.subscriptionStatus ?? null,
        billingAccess: row.isAdmin || (entitlement?.accessGranted ?? false),
        cancelAtPeriodEnd: entitlement?.cancelAtPeriodEnd ?? false,
        currentPeriodEnd: entitlement?.currentPeriodEnd ?? null,
      }
    })

    // `paid` needs the joined entitlement, so it filters after the merge.
    return input.filter === 'paid'
      ? users.filter((row) => row.plan === 'pro' || row.plan === 'studio')
      : users
  })

export async function requireOtherUser(selfId: string, userId: string, action: string) {
  if (userId === selfId) {
    throw new ORPCError('FORBIDDEN', { message: `You cannot ${action} your own account.` })
  }
  const [target] = await db
    .select({ id: user.id, email: user.email, isAdmin: user.isAdmin })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!target) throw new ORPCError('NOT_FOUND')
  return target
}

export const setUserAdmin = adminProcedure
  .input(
    z.object({
      userId: z.string().min(1).max(128),
      isAdmin: z.boolean(),
    }),
  )
  .handler(async ({ context, input }) => {
    await requireOtherUser(context.user.id, input.userId, 'change admin access on')
    const [updated] = await db
      .update(user)
      .set({
        isAdmin: input.isAdmin,
        // An admin bypasses the preview gate anyway; granting it too keeps the
        // account usable after admin is later revoked.
        previewAccess: input.isAdmin ? true : undefined,
        previewAccessRequestedAt: input.isAdmin ? null : undefined,
        updatedAt: new Date(),
      })
      .where(eq(user.id, input.userId))
      .returning({
        userId: user.id,
        isAdmin: user.isAdmin,
        previewAccess: user.previewAccess,
      })
    if (!updated) throw new ORPCError('NOT_FOUND')
    return updated
  })

export const approvePendingPreviewAccess = adminProcedure.handler(async () => {
  const granted = await db
    .update(user)
    .set({ previewAccess: true, previewAccessRequestedAt: null, updatedAt: new Date() })
    .where(
      and(isNotNull(user.previewAccessRequestedAt), eq(user.previewAccess, false)),
    )
    .returning({ userId: user.id })
  return { granted: granted.length }
})

export const refreshUserBilling = adminProcedure
  .input(z.object({ userId: z.string().min(1).max(128) }))
  .handler(async ({ input }) => {
    const [target] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, input.userId))
      .limit(1)
    if (!target) throw new ORPCError('NOT_FOUND')

    let entitlement: Awaited<ReturnType<typeof refreshEntitlement>> = null
    try {
      entitlement = await refreshEntitlement(input.userId)
    } catch (error) {
      throw new ORPCError('BAD_GATEWAY', {
        message:
          error instanceof Error && error.message
            ? `Polar refresh failed: ${error.message}`
            : 'Polar refresh failed.',
      })
    }
    return {
      plan: entitlement?.plan ?? null,
      subscriptionStatus: entitlement?.subscriptionStatus ?? null,
      accessGranted: entitlement?.accessGranted ?? false,
      currentPeriodEnd: entitlement?.currentPeriodEnd ?? null,
    }
  })

/** Sign an account out of every browser session. Their data is untouched. */
export const revokeUserSessions = adminProcedure
  .input(z.object({ userId: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    await requireOtherUser(context.user.id, input.userId, 'sign out')
    const revoked = await db
      .delete(authSession)
      .where(eq(authSession.userId, input.userId))
      .returning({ id: authSession.id })
    return { revoked: revoked.length }
  })

/** Disconnect every MCP client authorized by an account. */
export const revokeUserMcpAccess = adminProcedure
  .input(z.object({ userId: z.string().min(1).max(128) }))
  .handler(async ({ input }) => {
    const [tokens, consents] = await Promise.all([
      db
        .delete(oauthAccessToken)
        .where(eq(oauthAccessToken.userId, input.userId))
        .returning({ id: oauthAccessToken.id }),
      db
        .delete(oauthConsent)
        .where(eq(oauthConsent.userId, input.userId))
        .returning({ id: oauthConsent.id }),
    ])
    return { tokens: tokens.length, consents: consents.length }
  })

export const listRecentDesigns = adminProcedure
  .input(
    z
      .object({
        search: z.string().trim().max(200).optional(),
        limit: z.number().int().min(1).max(100).default(25),
      })
      .default({ limit: 25 }),
  )
  .handler(async ({ input }) => {
    const search = input.search?.trim()
    const rows = await db
      .select({
        id: design.id,
        name: design.name,
        userId: design.userId,
        ownerName: user.name,
        ownerEmail: user.email,
        linkAccess: design.linkAccess,
        revision: design.revision,
        createdAt: design.createdAt,
        updatedAt: design.updatedAt,
      })
      .from(design)
      .innerJoin(user, eq(design.userId, user.id))
      .where(
        search
          ? or(
              ilike(design.name, likeTerm(search)),
              ilike(user.email, likeTerm(search)),
            )
          : undefined,
      )
      .orderBy(desc(design.updatedAt))
      .limit(input.limit)

    if (rows.length === 0) return []

    const ids = rows.map((row) => row.id)
    const shareRows = await db
      .select({ designId: designShare.designId, shares: count() })
      .from(designShare)
      .where(inArray(designShare.designId, ids))
      .groupBy(designShare.designId)
    const shareBy = new Map(shareRows.map((row) => [row.designId, row.shares]))

    return rows.map((row) => ({
      ...row,
      shares: toCount(shareBy.get(row.id)),
    }))
  })

/**
 * Takedown for a design that is shared more widely than it should be: its
 * editor link falls back to restricted, so only the owner and the people in
 * `design_share` can open it. The document itself is left alone.
 */
export const revokeDesignLinks = adminProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      userId: z.string().min(1).max(128),
    }),
  )
  .handler(async ({ input }) => {
    const [target] = await db
      .select({ id: design.id })
      .from(design)
      .where(and(eq(design.id, input.designId), eq(design.userId, input.userId)))
      .limit(1)
    if (!target) throw new ORPCError('NOT_FOUND')

    await db
      .update(design)
      .set({ linkAccess: 'restricted', updatedAt: new Date() })
      .where(and(eq(design.id, input.designId), eq(design.userId, input.userId)))
    return { restricted: true }
  })

export const setUserPreviewAccess = adminProcedure
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

export const deleteUserAccount = adminProcedure
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
