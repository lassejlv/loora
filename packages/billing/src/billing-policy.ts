import type { CustomerState } from '@polar-sh/sdk/models/components/customerstate.js'
import type { PolarConfig } from './polar'

export type BillingPlan = 'pro' | 'studio'

export interface NormalizedEntitlement {
  polarCustomerId: string
  polarSubscriptionId: string | null
  productId: string | null
  plan: BillingPlan | null
  subscriptionStatus: 'active' | 'trialing' | null
  accessGranted: boolean
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  trialStart: Date | null
  trialEnd: Date | null
  cancelAtPeriodEnd: boolean
  meterBalance: number
  creditedUnits: number
  consumedUnits: number
  syncedAt: Date
}

export function remainingCredits(balance: number) {
  return Math.max(0, balance)
}

export function creditUnitsForCost(costMicroUsd: number) {
  return Math.max(1, Math.ceil(costMicroUsd / 10_000))
}

export function shouldApplyWebhook(lastEventAt: Date | null, eventAt: Date) {
  return !lastEventAt || eventAt.getTime() >= lastEventAt.getTime()
}

export function usesPolarCredits(usingChatGPT: boolean, source: string) {
  return !usingChatGPT && source === 'cache'
}

export function polarIngestAcknowledged(response: { inserted: number; duplicates: number }) {
  return response.inserted + response.duplicates > 0
}

export function leaseAvailable(expiresAt: Date | null, now = new Date()) {
  return !expiresAt || expiresAt.getTime() <= now.getTime()
}

export function leaseTokenCanRelease(activeToken: string | null, token: string) {
  return activeToken === token
}

export function normalizeCustomerState(
  state: CustomerState,
  config: Pick<PolarConfig, 'proProductId' | 'studioProductId' | 'accessBenefitId' | 'aiMeterId'>,
  now = new Date(),
): NormalizedEntitlement {
  const recognized = state.activeSubscriptions
    .filter((subscription) => {
      const recognizedProduct = subscription.productId === config.proProductId ||
        subscription.productId === config.studioProductId
      const active = subscription.status === 'active'
      const proTrial = subscription.status === 'trialing' &&
        subscription.productId === config.proProductId &&
        Boolean(subscription.trialEnd && subscription.trialEnd.getTime() > now.getTime())
      return recognizedProduct && subscription.currentPeriodEnd.getTime() > now.getTime() &&
        (active || proTrial)
    })
    .sort((left, right) => {
      const score = (subscription: typeof left) => subscription.status === 'active'
        ? subscription.productId === config.studioProductId ? 3 : 2
        : 1
      return score(right) - score(left)
    })
  const subscription = recognized[0] ?? null
  const trial = subscription?.status === 'trialing'
  const accessBenefit = state.grantedBenefits.some(
    (benefit) => benefit.benefitId === config.accessBenefitId,
  )
  const meter = state.activeMeters.find((item) => item.meterId === config.aiMeterId)

  return {
    polarCustomerId: state.id,
    polarSubscriptionId: subscription?.id ?? null,
    productId: subscription?.productId ?? null,
    plan: subscription
      ? subscription.productId === config.studioProductId
        ? 'studio'
        : 'pro'
      : null,
    subscriptionStatus: subscription?.status === 'active'
      ? 'active'
      : subscription?.status === 'trialing' ? 'trialing' : null,
    accessGranted: Boolean(subscription && (accessBenefit || trial)),
    currentPeriodStart: subscription?.currentPeriodStart ?? null,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    trialStart: subscription?.trialStart ?? null,
    trialEnd: subscription?.trialEnd ?? null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    meterBalance: Math.round(meter?.balance ?? 0),
    creditedUnits: meter?.creditedUnits ?? 0,
    consumedUnits: Math.round(meter?.consumedUnits ?? 0),
    syncedAt: now,
  }
}

type TrialEntitlement = {
  plan: string | null
  subscriptionStatus: string | null
  trialEnd: Date | null
}

export function entitlementIsTrial(entitlement: TrialEntitlement | null, now = new Date()) {
  return Boolean(
    entitlement?.plan === 'pro' &&
    entitlement.subscriptionStatus === 'trialing' &&
    entitlement.trialEnd && entitlement.trialEnd.getTime() > now.getTime(),
  )
}

export function entitlementCapabilities(entitlement: TrialEntitlement | null, now = new Date()) {
  const trial = entitlementIsTrial(entitlement, now)
  return {
    trial,
    managedAiAccess: !trial,
    topUpAccess: !trial,
  }
}

export function cachedEntitlementGrantsAccess(
  entitlement: {
    accessGranted: boolean
    plan: string | null
    subscriptionStatus: string | null
    currentPeriodEnd: Date | null
    trialEnd: Date | null
  } | null,
  now = new Date(),
) {
  return Boolean(
    entitlement?.accessGranted && entitlement.plan && entitlement.currentPeriodEnd &&
    entitlement.currentPeriodEnd.getTime() > now.getTime() &&
    (entitlement.subscriptionStatus !== 'trialing' || entitlementIsTrial(entitlement, now)),
  )
}
