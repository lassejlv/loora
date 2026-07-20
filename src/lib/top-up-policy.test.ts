import { describe, expect, test } from 'bun:test'
import type { Order } from '@polar-sh/sdk/models/components/order.js'
import {
  MAX_TOP_UP_CENTS,
  MIN_TOP_UP_CENTS,
  allocateTopUpCredits,
  availableTopUpCredits,
  creditsForTopUpAmount,
  isValidTopUpAmount,
  paidTopUpFromOrder,
} from './top-up-policy'

function order(overrides: Partial<Order> = {}) {
  return {
    id: 'order-1',
    paid: true,
    currency: 'usd',
    subtotalAmount: 1_000,
    netAmount: 1_000,
    productId: 'top-up',
    checkoutId: 'checkout-1',
    customerId: 'customer-1',
    customer: { externalId: 'user-1' },
    metadata: { loora_kind: 'credit_top_up', loora_user_id: 'user-1' },
    ...overrides,
  } as Order
}

describe('credit top-up policy', () => {
  test('accepts $5 through $500 and grants ten credits per dollar', () => {
    expect(isValidTopUpAmount(MIN_TOP_UP_CENTS)).toBe(true)
    expect(isValidTopUpAmount(MAX_TOP_UP_CENTS)).toBe(true)
    expect(isValidTopUpAmount(MIN_TOP_UP_CENTS - 1)).toBe(false)
    expect(isValidTopUpAmount(MAX_TOP_UP_CENTS + 1)).toBe(false)
    expect(creditsForTopUpAmount(500)).toBe(50)
    expect(creditsForTopUpAmount(50_000)).toBe(5_000)
  })

  test('tracks durable balance after refunds and usage', () => {
    expect(availableTopUpCredits(200, 50, 25)).toBe(125)
    expect(availableTopUpCredits(100, 100, 50)).toBe(0)
    expect(allocateTopUpCredits(30, 20, 100)).toBe(10)
    expect(allocateTopUpCredits(30, 0, 12)).toBe(12)
  })

  test('normalizes only paid matching orders for the authenticated user', () => {
    expect(paidTopUpFromOrder(order(), 'top-up', 'user-1')).toEqual({
      polarOrderId: 'order-1',
      userId: 'user-1',
      polarCheckoutId: 'checkout-1',
      polarCustomerId: 'customer-1',
      productId: 'top-up',
      amountCents: 1_000,
      creditUnits: 100,
    })
    expect(paidTopUpFromOrder(order(), 'other-product')).toBeNull()
    expect(() => paidTopUpFromOrder(order({ paid: false }), 'top-up')).toThrow('not paid')
    expect(() => paidTopUpFromOrder(order(), 'top-up', 'user-2')).toThrow('does not belong')
  })
})
