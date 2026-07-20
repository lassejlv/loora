import { eq, sql } from 'drizzle-orm'
import type { Order } from '@polar-sh/sdk/models/components/order.js'
import { db } from '@loora/db'
import { aiUsage, billingCreditTopUp, user } from '@loora/db/schema'
import { getPolarClient, getPolarRuntime } from './polar'
import {
  availableTopUpCredits,
  creditsForTopUpAmount,
  isValidTopUpAmount,
  paidTopUpFromOrder,
  TOP_UP_CENTS_PER_CREDIT,
} from './top-up-policy'

function topUpProductId() {
  const productId = getPolarRuntime().config?.topUpProductId
  if (!productId) throw new Error('Polar top-ups are not configured')
  return productId
}

export async function getTopUpCreditStatus(userId: string) {
  const [purchases, usage] = await Promise.all([
    db
      .select({
        granted: sql<number>`coalesce(sum(${billingCreditTopUp.creditUnits}), 0)::bigint`,
        refunded: sql<number>`coalesce(sum(${billingCreditTopUp.refundedCreditUnits}), 0)::bigint`,
      })
      .from(billingCreditTopUp)
      .where(eq(billingCreditTopUp.userId, userId)),
    db
      .select({
        consumed: sql<number>`coalesce(sum(${aiUsage.topUpCreditUnits}), 0)::bigint`,
      })
      .from(aiUsage)
      .where(eq(aiUsage.userId, userId)),
  ])
  const granted = Number(purchases[0]?.granted ?? 0)
  const refunded = Number(purchases[0]?.refunded ?? 0)
  const consumed = Number(usage[0]?.consumed ?? 0)
  return {
    granted,
    refunded,
    consumed,
    remaining: availableTopUpCredits(granted, refunded, consumed),
  }
}

export async function applyPaidTopUpOrder(
  order: Order,
  paidAt = new Date(),
  expectedUserId?: string,
) {
  const topUp = paidTopUpFromOrder(order, topUpProductId(), expectedUserId)
  if (!topUp) return null

  const [account] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, topUp.userId))
    .limit(1)
  if (!account) throw new Error('Top-up user does not exist')

  await db
    .insert(billingCreditTopUp)
    .values({ ...topUp, paidAt })
    .onConflictDoNothing({ target: billingCreditTopUp.polarOrderId })

  const [saved] = await db
    .select()
    .from(billingCreditTopUp)
    .where(eq(billingCreditTopUp.polarOrderId, topUp.polarOrderId))
    .limit(1)
  if (!saved || saved.userId !== topUp.userId || saved.productId !== topUp.productId ||
    saved.amountCents !== topUp.amountCents || saved.creditUnits !== topUp.creditUnits) {
    throw new Error('Stored top-up order does not match Polar')
  }
  return saved
}

export async function applyRefundedTopUpOrder(order: Order, eventAt = new Date()) {
  const paid = await applyPaidTopUpOrder(order, eventAt)
  if (!paid) return null

  const refundedAmountCents = Math.min(
    paid.amountCents,
    Math.max(0, order.refundedAmount),
  )
  const refundedCreditUnits = Math.min(
    paid.creditUnits,
    Math.floor(refundedAmountCents / TOP_UP_CENTS_PER_CREDIT),
  )
  const [updated] = await db
    .update(billingCreditTopUp)
    .set({
      refundedAmountCents: sql`greatest(${billingCreditTopUp.refundedAmountCents}, ${refundedAmountCents})`,
      refundedCreditUnits: sql`greatest(${billingCreditTopUp.refundedCreditUnits}, ${refundedCreditUnits})`,
      updatedAt: eventAt,
    })
    .where(eq(billingCreditTopUp.polarOrderId, paid.polarOrderId))
    .returning()
  return updated ?? paid
}

export async function createTopUpCheckout(userId: string, amountCents: number) {
  if (!isValidTopUpAmount(amountCents)) throw new Error('Invalid top-up amount')
  const { config } = getPolarRuntime()
  if (!config) throw new Error('Polar top-ups are not configured')

  const checkout = await getPolarClient().checkouts.create({
    products: [config.topUpProductId],
    amount: amountCents,
    externalCustomerId: userId,
    metadata: {
      loora_kind: 'credit_top_up',
      loora_user_id: userId,
    },
    allowDiscountCodes: false,
    successUrl: `${config.origin}/?topup=success&checkout_id={CHECKOUT_ID}`,
    returnUrl: config.origin,
  })
  return {
    url: checkout.url,
    amountCents,
    creditUnits: creditsForTopUpAmount(amountCents),
  }
}

export async function completeTopUpCheckout(userId: string, checkoutId: string) {
  const { config } = getPolarRuntime()
  if (!config) throw new Error('Polar top-ups are not configured')
  const checkout = await getPolarClient().checkouts.get({ id: checkoutId })
  if (checkout.productId !== config.topUpProductId ||
    checkout.externalCustomerId !== userId ||
    checkout.metadata.loora_kind !== 'credit_top_up' ||
    checkout.metadata.loora_user_id !== userId) {
    throw new Error('Top-up checkout does not belong to this user')
  }
  if (checkout.status !== 'succeeded') return null

  for await (const page of await getPolarClient().orders.list({
    checkoutId,
    externalCustomerId: userId,
    productId: config.topUpProductId,
    limit: 10,
  })) {
    const order = page.result.items.find((item) => item.paid)
    if (order) return applyPaidTopUpOrder(order, order.modifiedAt ?? new Date(), userId)
  }
  return null
}
