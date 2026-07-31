import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import {
  authorizeBilling,
  createPlanCheckout,
  getBillingStatus,
  refreshBillingStatus,
} from '@loora/billing/billing'
import {
  getMcpUsage,
  McpUsageUnavailableError,
  resolveMcpUsagePlan,
} from '@loora/billing/mcp-usage'
import { previewProcedure } from './procedures'

/**
 * The `billing` namespace: plan status, checkout, and metered MCP usage.
 */

export const getCurrentBilling = previewProcedure.handler(({ context }) =>
  getBillingStatus(context.user),
)

export const refreshCurrentBilling = previewProcedure.handler(({ context }) =>
  refreshBillingStatus(context.user),
)

export const createSubscriptionCheckout = previewProcedure
  .input(
    z.object({
      plan: z.enum(['free', 'pro']),
      /** Billing cycle for Pro. Ignored for Free. */
      interval: z.enum(['month', 'year']).default('month'),
    }),
  )
  .handler(async ({ context, input }) => {
    const billing = await authorizeBilling(context.user)
    if (billing.access) {
      const current = billing.entitlement?.plan
      // Free → Pro upgrade is allowed (monthly or yearly). Paid plans manage
      // changes in the Polar customer portal.
      const upgradingFreeToPro = input.plan === 'pro' && current === 'free'
      if (!upgradingFreeToPro) {
        throw new ORPCError('FORBIDDEN', {
          message: 'Manage your existing subscription from Billing.',
        })
      }
    }
    return createPlanCheckout(
      context.user,
      input.plan,
      input.plan === 'pro' ? input.interval : 'month',
    )
  })

export const getCurrentMcpUsage = previewProcedure.handler(async ({ context }) => {
  // Same refresh path as billing.status so plan labels and weekly included
  // limits stay aligned when both load in parallel on the billing page.
  const status = await getBillingStatus(context.user)
  const plan = resolveMcpUsagePlan({
    source: status.source,
    access: status.access,
    plan: status.plan,
  })
  if (!plan) return { usage: null }
  try {
    return { usage: await getMcpUsage(context.user.id, plan) }
  } catch (error) {
    if (error instanceof McpUsageUnavailableError) {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: 'MCP usage is temporarily unavailable.',
      })
    }
    throw error
  }
})
