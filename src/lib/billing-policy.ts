import type { CustomerState } from '@polar-sh/sdk/models/components/customerstate.js'
import type { PolarConfig } from '#/lib/polar'

export type BillingPlan = 'pro' | 'studio'

export interface NormalizedEntitlement {
  polarCustomerId: string
  polarSubscriptionId: string | null
  productId: string | null
  plan: BillingPlan | null
  accessGranted: boolean
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
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
    .filter((subscription) =>
      subscription.status === 'active' &&
      subscription.currentPeriodEnd.getTime() > now.getTime() &&
      (subscription.productId === config.proProductId || subscription.productId === config.studioProductId)
    )
    .sort((left, right) => {
      const leftStudio = left.productId === config.studioProductId ? 1 : 0
      const rightStudio = right.productId === config.studioProductId ? 1 : 0
      return rightStudio - leftStudio
    })
  const subscription = recognized[0] ?? null
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
    accessGranted: Boolean(subscription && accessBenefit),
    currentPeriodStart: subscription?.currentPeriodStart ?? null,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    meterBalance: Math.round(meter?.balance ?? 0),
    creditedUnits: meter?.creditedUnits ?? 0,
    consumedUnits: Math.round(meter?.consumedUnits ?? 0),
    syncedAt: now,
  }
}

export function cachedEntitlementGrantsAccess(
  entitlement: { accessGranted: boolean; plan: string | null; currentPeriodEnd: Date | null } | null,
  now = new Date(),
) {
  return Boolean(
    entitlement?.accessGranted && entitlement.plan && entitlement.currentPeriodEnd &&
    entitlement.currentPeriodEnd.getTime() > now.getTime(),
  )
}
