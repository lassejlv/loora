import { describe, expect, test } from 'bun:test'
import type { CustomerState } from '@polar-sh/sdk/models/components/customerstate.js'
import {
  cachedEntitlementGrantsAccess,
  creditUnitsForCost,
  leaseAvailable,
  leaseTokenCanRelease,
  normalizeCustomerState,
  polarIngestAcknowledged,
  remainingCredits,
  shouldApplyWebhook,
  usesPolarCredits,
} from './billing-policy'

const now = new Date('2026-07-20T12:00:00Z')
const config = {
  proProductId: 'pro',
  studioProductId: 'studio',
  accessBenefitId: 'access',
  aiMeterId: 'meter',
}

function state(overrides: Partial<CustomerState> = {}) {
  return {
    id: 'customer',
    externalId: 'user',
    activeSubscriptions: [],
    grantedBenefits: [],
    activeMeters: [],
    ...overrides,
  } as CustomerState
}

function subscription(productId: string, end = '2026-08-20T12:00:00Z') {
  return {
    id: `subscription-${productId}`,
    productId,
    status: 'active' as const,
    currentPeriodStart: new Date('2026-07-20T12:00:00Z'),
    currentPeriodEnd: new Date(end),
    cancelAtPeriodEnd: false,
  } as CustomerState['activeSubscriptions'][number]
}

describe('billing policy', () => {
  test('requires a recognized active product and the access benefit', () => {
    const normalized = normalizeCustomerState(state({
      activeSubscriptions: [subscription('unknown'), subscription('pro')],
      grantedBenefits: [{ benefitId: 'access' } as never],
    }), config, now)
    expect(normalized.plan).toBe('pro')
    expect(normalized.accessGranted).toBe(true)

    const missingBenefit = normalizeCustomerState(state({
      activeSubscriptions: [subscription('pro')],
    }), config, now)
    expect(missingBenefit.accessGranted).toBe(false)
  })

  test('Studio takes precedence and cancellation retains access through period end', () => {
    const studio = { ...subscription('studio'), cancelAtPeriodEnd: true }
    const normalized = normalizeCustomerState(state({
      activeSubscriptions: [subscription('pro'), studio],
      grantedBenefits: [{ benefitId: 'access' } as never],
    }), config, now)
    expect(normalized.plan).toBe('studio')
    expect(normalized.cancelAtPeriodEnd).toBe(true)
    expect(cachedEntitlementGrantsAccess(normalized, now)).toBe(true)
  })

  test('expired periods are denied even when listed by Polar', () => {
    const normalized = normalizeCustomerState(state({
      activeSubscriptions: [subscription('pro', '2026-07-19T12:00:00Z')],
      grantedBenefits: [{ benefitId: 'access' } as never],
    }), config, now)
    expect(normalized.accessGranted).toBe(false)
    expect(cachedEntitlementGrantsAccess(normalized, now)).toBe(false)
  })

  test('converts negative balances and rounds one-cent credit units', () => {
    expect(remainingCredits(-37)).toBe(37)
    expect(remainingCredits(0)).toBe(0)
    expect(remainingCredits(12)).toBe(0)
    expect(creditUnitsForCost(0)).toBe(1)
    expect(creditUnitsForCost(10_000)).toBe(1)
    expect(creditUnitsForCost(10_001)).toBe(2)
  })

  test('accepts duplicate timestamps and rejects older webhook events', () => {
    const last = new Date('2026-07-20T12:00:00Z')
    expect(shouldApplyWebhook(last, new Date('2026-07-20T12:00:00Z'))).toBe(true)
    expect(shouldApplyWebhook(last, new Date('2026-07-20T12:00:01Z'))).toBe(true)
    expect(shouldApplyWebhook(last, new Date('2026-07-20T11:59:59Z'))).toBe(false)
  })

  test('treats inserted and duplicate events as successful acknowledgements', () => {
    expect(polarIngestAcknowledged({ inserted: 1, duplicates: 0 })).toBe(true)
    expect(polarIngestAcknowledged({ inserted: 0, duplicates: 1 })).toBe(true)
    expect(polarIngestAcknowledged({ inserted: 0, duplicates: 0 })).toBe(false)
  })

  test('leases conflict until expiry and only their token can release', () => {
    expect(leaseAvailable(null, now)).toBe(true)
    expect(leaseAvailable(new Date('2026-07-20T12:05:00Z'), now)).toBe(false)
    expect(leaseAvailable(new Date('2026-07-20T12:00:00Z'), now)).toBe(true)
    expect(leaseTokenCanRelease('token-a', 'token-a')).toBe(true)
    expect(leaseTokenCanRelease('token-a', 'token-b')).toBe(false)
  })

  test('ChatGPT-backed and internal requests do not consume Polar credits', () => {
    expect(usesPolarCredits(true, 'cache')).toBe(false)
    expect(usesPolarCredits(false, 'admin')).toBe(false)
    expect(usesPolarCredits(false, 'disabled')).toBe(false)
    expect(usesPolarCredits(false, 'cache')).toBe(true)
  })
})
