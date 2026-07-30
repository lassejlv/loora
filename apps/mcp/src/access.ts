import { eq } from 'drizzle-orm'
import { db } from '@loora/db'
import { user } from '@loora/db/schema'
import { canUseApp } from '@loora/auth/preview-access'
import { hasAcceptedCurrentLegal } from '@loora/auth/legal-consent'
import { authorizeBilling } from '@loora/billing/billing'
import { resolveMcpUsagePlan } from '@loora/billing/mcp-usage'

export class AccessDeniedError extends Error {}

// Mirrors the oRPC protectedProcedure gates (packages/rpc/src/router.ts): a
// valid OAuth token is not enough, the user also needs preview access and an
// active plan.
export async function requireAppAccess(userId: string) {
  const [account] = await db.select().from(user).where(eq(user.id, userId)).limit(1)
  if (!account) throw new AccessDeniedError('Unknown user.')
  if (!hasAcceptedCurrentLegal(account)) {
    throw new AccessDeniedError('The current Terms of Service and Privacy Policy must be accepted.')
  }
  if (!canUseApp(account)) throw new AccessDeniedError('Preview access is required.')
  const billing = await authorizeBilling(account)
  if (!billing.access) {
    throw new AccessDeniedError('An active Loora plan is required.')
  }
  const mcpPlan = resolveMcpUsagePlan({
    source: billing.source,
    access: billing.access,
    plan: billing.entitlement?.plan === 'free' ||
      billing.entitlement?.plan === 'pro' ||
      billing.entitlement?.plan === 'studio'
      ? billing.entitlement.plan
      : null,
  })
  if (!mcpPlan) {
    throw new AccessDeniedError('A recognized Loora plan is required.')
  }
  return { account, mcpPlan }
}
