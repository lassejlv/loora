import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@loora/db'
import { user } from '@loora/db/schema'
import {
  authorizeBilling,
  createPlanCheckout,
  getBillingStatus,
  refreshBillingStatus,
} from '@loora/billing/billing'
import {
  getAgentUsage,
  getMcpUsage,
  McpUsageUnavailableError,
  resolveMcpUsagePlan,
  type McpUsageOptions,
  type McpUsagePlan,
  type ToolUsage,
} from '@loora/billing/mcp-usage'
import { previewProcedure } from './procedures'

/**
 * The `billing` namespace: plan status, checkout, and the two metered
 * tool-call surfaces — MCP and the in-app agent, counted separately.
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

/**
 * Both usage procedures do the same three things: refresh billing so the plan
 * label matches `billing.status` when they load together, read this account's
 * override for the surface, then ask that surface's meter.
 */
async function currentUsage(
  account: { id: string } & Record<string, unknown>,
  read: (
    userId: string,
    plan: McpUsagePlan,
    now: Date,
    options: McpUsageOptions,
  ) => Promise<ToolUsage>,
  columns: {
    weeklyLimit: typeof user.mcpWeeklyLimit | typeof user.agentWeeklyLimit
    resetAt: typeof user.mcpUsageResetAt | typeof user.agentUsageResetAt
  },
) {
  const status = await getBillingStatus(account as Parameters<typeof getBillingStatus>[0])
  const plan = resolveMcpUsagePlan({
    source: status.source,
    access: status.access,
    plan: status.plan,
  })
  if (!plan) return { usage: null }
  try {
    const [override] = await db
      .select({ weeklyLimit: columns.weeklyLimit, resetAt: columns.resetAt })
      .from(user)
      .where(eq(user.id, account.id))
      .limit(1)
    return { usage: await read(account.id, plan, new Date(), override ?? {}) }
  } catch (error) {
    if (error instanceof McpUsageUnavailableError) {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: 'Usage metering is temporarily unavailable.',
      })
    }
    throw error
  }
}

export const getCurrentMcpUsage = previewProcedure.handler(({ context }) =>
  currentUsage(context.user, getMcpUsage, {
    weeklyLimit: user.mcpWeeklyLimit,
    resetAt: user.mcpUsageResetAt,
  }),
)

export const getCurrentAgentUsage = previewProcedure.handler(({ context }) =>
  currentUsage(context.user, getAgentUsage, {
    weeklyLimit: user.agentWeeklyLimit,
    resetAt: user.agentUsageResetAt,
  }),
)
