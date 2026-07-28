import { describe, expect, test } from 'bun:test'
import type { CustomerState } from '@polar-sh/sdk/models/components/customerstate.js'
import {
  cachedEntitlementGrantsAccess,
  normalizeCustomerState,
  shouldApplyWebhook,
} from './billing-policy'

const now = new Date('2026-07-20T12:00:00Z')
const config = {
  proProductId: 'pro',
  studioProductId: 'studio',
  accessBenefitId: 'access',
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

function subscription(
  productId: string,
  end = '2026-08-20T12:00:00Z',
  overrides: Partial<CustomerState['activeSubscriptions'][number]> = {},
) {
  return {
    id: `subscription-${productId}`,
    productId,
    status: 'active' as const,
    currentPeriodStart: new Date('2026-07-20T12:00:00Z'),
    currentPeriodEnd: new Date(end),
    cancelAtPeriodEnd: false,
    trialStart: null,
    trialEnd: null,
    ...overrides,
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

  test('grants app access during a Pro trial', () => {
    const trialEnd = new Date('2026-07-23T12:00:00Z')
    const normalized = normalizeCustomerState(state({
      activeSubscriptions: [subscription('pro', trialEnd.toISOString(), {
        status: 'trialing',
        trialStart: now,
        trialEnd,
      })],
    }), config, now)

    expect(normalized.plan).toBe('pro')
    expect(normalized.subscriptionStatus).toBe('trialing')
    expect(normalized.accessGranted).toBe(true)
    expect(cachedEntitlementGrantsAccess(normalized, now)).toBe(true)
  })

  test('does not recognize expired or Studio trials', () => {
    const expired = subscription('pro', '2026-07-21T12:00:00Z', {
      status: 'trialing',
      trialStart: new Date('2026-07-18T12:00:00Z'),
      trialEnd: new Date('2026-07-21T12:00:00Z'),
    })
    const studio = subscription('studio', '2026-07-24T12:00:00Z', {
      status: 'trialing',
      trialStart: now,
      trialEnd: new Date('2026-07-24T12:00:00Z'),
    })
    const normalized = normalizeCustomerState(state({
      activeSubscriptions: [expired, studio],
      grantedBenefits: [{ benefitId: 'access' } as never],
    }), config, new Date('2026-07-22T12:00:00Z'))

    expect(normalized.plan).toBeNull()
    expect(normalized.accessGranted).toBe(false)
  })

  test('accepts duplicate timestamps and rejects older webhook events', () => {
    const last = new Date('2026-07-20T12:00:00Z')
    expect(shouldApplyWebhook(last, new Date('2026-07-20T12:00:00Z'))).toBe(true)
    expect(shouldApplyWebhook(last, new Date('2026-07-20T12:00:01Z'))).toBe(true)
    expect(shouldApplyWebhook(last, new Date('2026-07-20T11:59:59Z'))).toBe(false)
  })
})
