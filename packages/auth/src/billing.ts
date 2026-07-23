import { and, eq, isNull, lte, or } from 'drizzle-orm'
import type { CustomerState } from '@polar-sh/sdk/models/components/customerstate.js'
import { db } from '@loora/db'
import { aiGenerationLease, billingEntitlement, user } from '@loora/db/schema'
import {
  cachedEntitlementGrantsAccess,
  entitlementCapabilities,
  normalizeCustomerState,
  remainingCredits,
  type BillingPlan,
} from './billing-policy'
import { getPolarClient, getPolarRuntime } from './polar'
import { flushPendingPolarUsage } from './billing-usage'
import { getTopUpCreditStatus } from './credit-top-ups'

const CACHE_MAX_AGE_MS = 5 * 60 * 1000
const REFRESH_RATE_LIMIT_MS = 10 * 1000
const LEASE_MS = 6 * 60 * 1000
const refreshedAt = new Map<string, number>()

export interface BillingStatus {
  required: boolean
  access: boolean
  plan: BillingPlan | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  trial: {
    active: true
    endsAt: string
  } | null
  credits: {
    remaining: number
    credited: number
    consumed: number
    includedRemaining: number
    topUpRemaining: number
    topUpPurchased: number
    resetsAt: string | null
  } | null
  stale: boolean
  source: 'polar' | 'cache' | 'admin' | 'disabled'
}

export function subscriptionRequiredResponse() {
  return Response.json(
    { error: 'An active Loora plan is required.', code: 'SUBSCRIPTION_REQUIRED' },
    { status: 403 },
  )
}

type BillingUser = { id: string; isAdmin?: boolean | null }

export async function getCachedEntitlement(userId: string) {
  const [row] = await db
    .select()
    .from(billingEntitlement)
    .where(eq(billingEntitlement.userId, userId))
    .limit(1)
  return row ?? null
}

export async function applyCustomerState(
  userId: string,
  state: CustomerState,
  eventAt: Date | null = null,
) {
  const { config } = getPolarRuntime()
  if (!config) return null
  const normalized = normalizeCustomerState(state, config)
  const values = { userId, ...normalized, lastEventAt: eventAt }
  const [saved] = await db
    .insert(billingEntitlement)
    .values(values)
    .onConflictDoUpdate({
      target: billingEntitlement.userId,
      set: normalized,
      setWhere: eventAt
        ? or(isNull(billingEntitlement.lastEventAt), lte(billingEntitlement.lastEventAt, eventAt))
        : undefined,
    })
    .returning()
  return saved ?? null
}

export async function applyCustomerStateWebhook(state: CustomerState, eventAt: Date) {
  const userId = state.externalId?.trim()
  if (!userId) return null
  const [account] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!account) return null
  const normalized = normalizeCustomerState(state, getPolarRuntime().config!)
  const [saved] = await db
    .insert(billingEntitlement)
    .values({ userId, ...normalized, lastEventAt: eventAt })
    .onConflictDoUpdate({
      target: billingEntitlement.userId,
      set: { ...normalized, lastEventAt: eventAt },
      setWhere: or(
        isNull(billingEntitlement.lastEventAt),
        lte(billingEntitlement.lastEventAt, eventAt),
      ),
    })
    .returning()
  return saved ?? null
}

export async function refreshEntitlement(userId: string) {
  const state = await getPolarClient().customers.getStateExternal({ externalId: userId })
  return applyCustomerState(userId, state)
}

async function clearEntitlement(userId: string) {
  const cleared = {
    polarCustomerId: null,
    polarSubscriptionId: null,
    productId: null,
    plan: null,
    subscriptionStatus: null,
    accessGranted: false,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    trialStart: null,
    trialEnd: null,
    cancelAtPeriodEnd: false,
    meterBalance: 0,
    creditedUnits: 0,
    consumedUnits: 0,
    syncedAt: new Date(),
  }
  const [saved] = await db
    .insert(billingEntitlement)
    .values({ userId, ...cleared })
    .onConflictDoUpdate({ target: billingEntitlement.userId, set: cleared })
    .returning()
  return saved
}

export async function authorizeBilling(user: BillingUser) {
  const { required } = getPolarRuntime()
  if (!required) {
    return {
      access: true,
      managedAiAccess: true,
      topUpAccess: true,
      trial: false,
      source: 'disabled' as const,
      entitlement: null,
    }
  }
  if (user.isAdmin === true) {
    return {
      access: true,
      managedAiAccess: true,
      topUpAccess: true,
      trial: false,
      source: 'admin' as const,
      entitlement: null,
    }
  }
  const entitlement = await getCachedEntitlement(user.id)
  const capabilities = entitlementCapabilities(entitlement)
  return {
    access: cachedEntitlementGrantsAccess(entitlement),
    ...capabilities,
    source: 'cache' as const,
    entitlement,
  }
}

async function statusFromEntitlement(
  userId: string,
  entitlement: typeof billingEntitlement.$inferSelect | null,
  source: BillingStatus['source'],
  stale: boolean,
): Promise<BillingStatus> {
  const capabilities = entitlementCapabilities(entitlement)
  const topUp = capabilities.topUpAccess
    ? await getTopUpCreditStatus(userId)
    : { granted: 0, refunded: 0, consumed: 0, remaining: 0 }
  const includedRemaining = remainingCredits(entitlement?.meterBalance ?? 0)
  return {
    required: true,
    access: cachedEntitlementGrantsAccess(entitlement),
    plan: entitlement?.plan === 'pro' || entitlement?.plan === 'studio' ? entitlement.plan : null,
    currentPeriodEnd: entitlement?.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: entitlement?.cancelAtPeriodEnd ?? false,
    trial: capabilities.trial && entitlement?.trialEnd
      ? { active: true, endsAt: entitlement.trialEnd.toISOString() }
      : null,
    credits: entitlement?.plan && capabilities.managedAiAccess
      ? {
          remaining: includedRemaining + topUp.remaining,
          credited: entitlement.creditedUnits + topUp.granted - topUp.refunded,
          consumed: entitlement.consumedUnits,
          includedRemaining,
          topUpRemaining: topUp.remaining,
          topUpPurchased: topUp.granted - topUp.refunded,
          resetsAt: entitlement.currentPeriodEnd?.toISOString() ?? null,
        }
      : null,
    stale,
    source,
  }
}

export async function getBillingStatus(user: BillingUser, force = false): Promise<BillingStatus> {
  const { required } = getPolarRuntime()
  if (!required) {
    return {
      required: false,
      access: true,
      plan: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trial: null,
      credits: null,
      stale: false,
      source: 'disabled',
    }
  }
  if (user.isAdmin === true) {
    return {
      required: true,
      access: true,
      plan: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trial: null,
      credits: null,
      stale: false,
      source: 'admin',
    }
  }

  let cached = await getCachedEntitlement(user.id)
  const stale = !cached || Date.now() - cached.syncedAt.getTime() > CACHE_MAX_AGE_MS
  if (force || stale) {
    try {
      const refreshed = await refreshEntitlement(user.id)
      return statusFromEntitlement(user.id, refreshed, 'polar', false)
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 404) {
        return statusFromEntitlement(user.id, await clearEntitlement(user.id), 'polar', false)
      }
      if (!cached) throw new Error('BILLING_TEMPORARILY_UNAVAILABLE')
    }
  }
  return statusFromEntitlement(user.id, cached, 'cache', stale)
}

export async function createPlanCheckout(
  user: { id: string; email: string },
  plan: BillingPlan,
) {
  const { config } = getPolarRuntime()
  if (!config) throw new Error('Polar is not configured')
  const proTrial = plan === 'pro'
  const checkout = await getPolarClient().checkouts.create({
    products: [proTrial ? config.proProductId : config.studioProductId],
    externalCustomerId: user.id,
    customerEmail: user.email,
    allowTrial: proTrial,
    trialInterval: proTrial ? 'day' : undefined,
    trialIntervalCount: proTrial ? 3 : undefined,
    metadata: {
      loora_kind: 'subscription',
      loora_plan: plan,
      loora_user_id: user.id,
    },
    successUrl: `${config.origin}/?checkout=success&checkout_id={CHECKOUT_ID}`,
    returnUrl: config.origin,
  })
  return { url: checkout.url }
}

export async function refreshBillingStatus(user: BillingUser) {
  const last = refreshedAt.get(user.id) ?? 0
  if (Date.now() - last < REFRESH_RATE_LIMIT_MS) return getBillingStatus(user)
  refreshedAt.set(user.id, Date.now())
  await flushPendingPolarUsage(user.id)
  return getBillingStatus(user, true)
}

export async function acquireGenerationLease(userId: string) {
  const now = new Date()
  const token = crypto.randomUUID()
  await db.delete(aiGenerationLease).where(and(
    eq(aiGenerationLease.userId, userId),
    lte(aiGenerationLease.expiresAt, now),
  ))
  const [lease] = await db
    .insert(aiGenerationLease)
    .values({ userId, token, acquiredAt: now, expiresAt: new Date(now.getTime() + LEASE_MS) })
    .onConflictDoNothing({ target: aiGenerationLease.userId })
    .returning({ token: aiGenerationLease.token })
  return lease?.token ?? null
}

export async function releaseGenerationLease(userId: string, token: string) {
  const deleted = await db
    .delete(aiGenerationLease)
    .where(and(eq(aiGenerationLease.userId, userId), eq(aiGenerationLease.token, token)))
    .returning({ token: aiGenerationLease.token })
  return deleted.length > 0
}
