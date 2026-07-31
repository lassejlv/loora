import { describe, expect, test } from 'bun:test'
import { authorizeBillingFromEntitlement } from './billing'

const activeEntitlement = {
  accessGranted: true,
  plan: 'pro',
  subscriptionStatus: 'active',
  currentPeriodEnd: new Date('2099-01-01T00:00:00Z'),
  trialEnd: null,
}

describe('authorizeBillingFromEntitlement', () => {
  test('preserves disabled and admin bypasses without an entitlement query', () => {
    expect(
      authorizeBillingFromEntitlement({ id: 'local' }, null, false),
    ).toMatchObject({ access: true, source: 'disabled' })
    expect(
      authorizeBillingFromEntitlement(
        { id: 'admin', isAdmin: true },
        null,
        true,
      ),
    ).toMatchObject({ access: true, source: 'admin' })
  })

  test('uses the joined cached entitlement for normal users', () => {
    const authorized = authorizeBillingFromEntitlement(
      { id: 'user' },
      activeEntitlement,
      true,
    )
    expect(authorized).toMatchObject({
      access: true,
      source: 'cache',
      entitlement: activeEntitlement,
    })

    expect(
      authorizeBillingFromEntitlement(
        { id: 'user' },
        { ...activeEntitlement, accessGranted: false },
        true,
      ).access,
    ).toBe(false)
  })
})
