import { and, count, eq, or } from 'drizzle-orm'
import { db } from '@loora/db'
import { design, designDraft } from '@loora/db/schema'
import { authorizeBilling } from './billing'
import {
  assertDesignFileCapacity,
  assertOpenBranchCapacity,
  limitsPlanFromBilling,
  planCapacity,
  type LimitsPlan,
} from './plan-limits'

type BillingUser = { id: string; isAdmin?: boolean | null }

async function capacityForUser(user: BillingUser) {
  const billing = await authorizeBilling(user)
  return planCapacity(
    limitsPlanFromBilling({
      source: billing.source,
      entitlementPlan: billing.entitlement?.plan,
    }),
  )
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

export async function requireDesignFileRoom(user: BillingUser) {
  const capacity = await capacityForUser(user)
  assertDesignFileCapacity(capacity, await countOwnedDesigns(user.id))
}

export async function requireOpenBranchRoom(user: BillingUser, designId: string) {
  const capacity = await capacityForUser(user)
  assertOpenBranchCapacity(capacity, await countOpenBranches(user.id, designId))
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
