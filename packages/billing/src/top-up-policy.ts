import type { Order } from '@polar-sh/sdk/models/components/order.js'

export const MIN_TOP_UP_CENTS = 500
export const MAX_TOP_UP_CENTS = 50_000
export const TOP_UP_CENTS_PER_CREDIT = 10

export function isValidTopUpAmount(amountCents: number) {
  return Number.isInteger(amountCents) &&
    amountCents >= MIN_TOP_UP_CENTS &&
    amountCents <= MAX_TOP_UP_CENTS
}

export function creditsForTopUpAmount(amountCents: number) {
  if (!isValidTopUpAmount(amountCents)) throw new Error('Invalid top-up amount')
  return Math.floor(amountCents / TOP_UP_CENTS_PER_CREDIT)
}

export function availableTopUpCredits(granted: number, refunded: number, consumed: number) {
  return Math.max(0, granted - refunded - consumed)
}

export function allocateTopUpCredits(
  requested: number,
  includedAvailable: number,
  topUpAvailable: number,
) {
  return Math.min(
    Math.max(0, topUpAvailable),
    Math.max(0, requested - Math.max(0, includedAvailable)),
  )
}

export interface PaidTopUp {
  polarOrderId: string
  userId: string
  polarCheckoutId: string | null
  polarCustomerId: string
  productId: string
  amountCents: number
  creditUnits: number
}

export function paidTopUpFromOrder(
  order: Order,
  topUpProductId: string,
  expectedUserId?: string,
): PaidTopUp | null {
  if (order.productId !== topUpProductId) return null
  if (!order.paid) throw new Error('Top-up order is not paid')
  if (order.currency.toLowerCase() !== 'usd') throw new Error('Top-up order must use USD')

  const userId = order.customer.externalId?.trim()
  if (!userId) throw new Error('Top-up order has no external customer ID')
  if (expectedUserId && userId !== expectedUserId) {
    throw new Error('Top-up order does not belong to this user')
  }
  const metadataUserId = order.metadata.loora_user_id
  if (metadataUserId !== undefined && metadataUserId !== userId) {
    throw new Error('Top-up order user metadata does not match its customer')
  }
  if (order.metadata.loora_kind !== 'credit_top_up') {
    throw new Error('Top-up order metadata is invalid')
  }

  return {
    polarOrderId: order.id,
    userId,
    polarCheckoutId: order.checkoutId,
    polarCustomerId: order.customerId,
    productId: order.productId,
    amountCents: order.netAmount,
    creditUnits: creditsForTopUpAmount(order.netAmount),
  }
}
