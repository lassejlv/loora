import { and, count, eq, lt, or, sum } from 'drizzle-orm'
import { db } from '@loora/db'
import { asset, design, designDraft, designVersion } from '@loora/db/schema'
import { authorizeBilling } from './billing'
import {
  assertDesignFileCapacity,
  assertHistoryVersionAccessible,
  assertOpenBranchCapacity,
  assertStorageCapacity,
  canHardPruneHistory,
  historyCutoff,
  limitsPlanFromBilling,
  planCapacity,
  type LimitsPlan,
  type PlanCapacity,
} from './plan-limits'

type BillingUser = { id: string; isAdmin?: boolean | null }

async function capacityForUser(user: BillingUser) {
  const billing = await authorizeBilling(user)
  const plan = limitsPlanFromBilling({
    source: billing.source,
    entitlementPlan: billing.entitlement?.plan,
  })
  return {
    capacity: planCapacity(plan),
    plan,
    /** True when entitlement/source named a real plan (not fail-closed Free). */
    planExplicit:
      billing.source === 'admin' ||
      billing.source === 'disabled' ||
      billing.entitlement?.plan === 'free' ||
      billing.entitlement?.plan === 'pro' ||
      billing.entitlement?.plan === 'studio',
  }
}

export async function countOwnedDesigns(userId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(design)
    .where(eq(design.userId, userId))
  return row?.n ?? 0
}

/** Open branches are active or proposed (still in flight). */
export async function countOpenBranches(userId: string, designId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(designDraft)
    .where(
      and(
        eq(designDraft.userId, userId),
        eq(designDraft.designId, designId),
        or(
          eq(designDraft.status, 'active'),
          eq(designDraft.status, 'proposed'),
        ),
      ),
    )
  return row?.n ?? 0
}

export async function sumOwnedAssetBytes(userId: string) {
  const [row] = await db
    .select({ total: sum(asset.size) })
    .from(asset)
    .where(eq(asset.userId, userId))
  // Drizzle/Postgres sum often returns string for bigints; coerce safely.
  const raw = row?.total
  if (raw === null || raw === undefined) return 0
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
}

export async function requireDesignFileRoom(user: BillingUser) {
  const { capacity } = await capacityForUser(user)
  assertDesignFileCapacity(capacity, await countOwnedDesigns(user.id))
}

export async function requireOpenBranchRoom(user: BillingUser, designId: string) {
  const { capacity } = await capacityForUser(user)
  assertOpenBranchCapacity(capacity, await countOpenBranches(user.id, designId))
}

export async function requireStorageRoom(user: BillingUser, incomingBytes: number) {
  const { capacity, plan } = await capacityForUser(user)
  assertStorageCapacity(
    capacity,
    await sumOwnedAssetBytes(user.id),
    incomingBytes,
    plan,
  )
}

export async function resolveHistoryCapacity(user: BillingUser) {
  return capacityForUser(user)
}

export function historyCutoffForCapacity(
  capacity: PlanCapacity,
  now = new Date(),
) {
  return historyCutoff(capacity.historyRetentionDays, now)
}

export async function requireHistoryVersionAccessible(
  user: BillingUser,
  createdAt: Date,
) {
  const { capacity, plan } = await capacityForUser(user)
  assertHistoryVersionAccessible(capacity, createdAt, plan)
}

/**
 * Drop versions older than the plan window. Only runs for an explicit Free /
 * Pro / Studio plan — never for fail-closed Free or unlimited admin/disabled.
 */
export async function pruneExpiredHistory(
  userId: string,
  capacity: PlanCapacity,
  plan: LimitsPlan | null | undefined,
  now = new Date(),
) {
  if (!canHardPruneHistory(plan)) return 0
  const cutoff = historyCutoff(capacity.historyRetentionDays, now)
  if (!cutoff) return 0
  const deleted = await db
    .delete(designVersion)
    .where(
      and(
        eq(designVersion.userId, userId),
        lt(designVersion.createdAt, cutoff),
      ),
    )
    .returning({ id: designVersion.id })
  return deleted.length
}

export async function pruneExpiredHistoryForUser(user: BillingUser) {
  const { capacity, plan, planExplicit } = await capacityForUser(user)
  // Fail-closed Free (no entitlement row / unrecognized plan) must not delete.
  if (!planExplicit || !canHardPruneHistory(plan)) return 0
  return pruneExpiredHistory(user.id, capacity, plan)
}

/** MCP already resolved the plan at connection time — skip a second billing round-trip. */
export async function requireDesignFileRoomForPlan(userId: string, plan: LimitsPlan) {
  assertDesignFileCapacity(planCapacity(plan), await countOwnedDesigns(userId))
}

export async function requireOpenBranchRoomForPlan(
  userId: string,
  designId: string,
  plan: LimitsPlan,
) {
  assertOpenBranchCapacity(
    planCapacity(plan),
    await countOpenBranches(userId, designId),
  )
}

export async function requireStorageRoomForPlan(
  userId: string,
  plan: LimitsPlan,
  incomingBytes: number,
) {
  assertStorageCapacity(
    planCapacity(plan),
    await sumOwnedAssetBytes(userId),
    incomingBytes,
    plan,
  )
}

export function historyCutoffForPlan(plan: LimitsPlan, now = new Date()) {
  return historyCutoff(planCapacity(plan).historyRetentionDays, now)
}

export async function pruneExpiredHistoryForPlan(userId: string, plan: LimitsPlan) {
  if (!canHardPruneHistory(plan)) return 0
  return pruneExpiredHistory(userId, planCapacity(plan), plan)
}
