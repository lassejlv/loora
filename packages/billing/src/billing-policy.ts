import type { CustomerState } from '@polar-sh/sdk/models/components/customerstate.js'
import type { PolarConfig } from './polar'

export type BillingPlan = 'free' | 'pro' | 'studio'

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
  syncedAt: Date
}

export function shouldApplyWebhook(lastEventAt: Date | null, eventAt: Date) {
  return !lastEventAt || eventAt.getTime() >= lastEventAt.getTime()
}

export function normalizeCustomerState(
  state: CustomerState,
  config: Pick<
    PolarConfig,
    'freeProductId' | 'proProductId' | 'proYearlyProductId' | 'studioProductId' | 'accessBenefitId'
  >,
  now = new Date(),
): NormalizedEntitlement {
  const planForProduct = (productId: string): BillingPlan | null => {
    if (productId === config.freeProductId) return 'free'
    if (productId === config.proProductId || productId === config.proYearlyProductId) return 'pro'
    if (config.studioProductId && productId === config.studioProductId) return 'studio'
    return null
  }
  const recognized = state.activeSubscriptions
    .filter((subscription) => {
      const plan = planForProduct(subscription.productId)
      const active = subscription.status === 'active'
      const proTrial = subscription.status === 'trialing' &&
        plan === 'pro' &&
        Boolean(subscription.trialEnd && subscription.trialEnd.getTime() > now.getTime())
      return plan && subscription.currentPeriodEnd.getTime() > now.getTime() &&
        (active || proTrial)
    })
    .sort((left, right) => {
      const score = (subscription: typeof left) => {
        if (subscription.status !== 'active') return 2
        const plan = planForProduct(subscription.productId)
        if (plan === 'studio') return 4
        if (plan === 'pro') return 3
        return 1
      }
      return score(right) - score(left)
    })
  const subscription = recognized[0] ?? null
  const trial = subscription?.status === 'trialing'
  const accessBenefit = state.grantedBenefits.some(
    (benefit) => benefit.benefitId === config.accessBenefitId,
  )

  return {
    polarCustomerId: state.id,
    polarSubscriptionId: subscription?.id ?? null,
    productId: subscription?.productId ?? null,
    plan: subscription ? planForProduct(subscription.productId) : null,
    subscriptionStatus: subscription?.status === 'active'
      ? 'active'
      : subscription?.status === 'trialing' ? 'trialing' : null,
    accessGranted: Boolean(subscription && (accessBenefit || trial)),
    currentPeriodStart: subscription?.currentPeriodStart ?? null,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    trialStart: subscription?.trialStart ?? null,
    trialEnd: subscription?.trialEnd ?? null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
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
