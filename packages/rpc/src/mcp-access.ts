import { eq } from 'drizzle-orm'
import { db } from '@loora/db'
import { billingEntitlement, user } from '@loora/db/schema'
import { canUseApp } from '@loora/auth/preview-access'
import { hasAcceptedCurrentLegal } from '@loora/auth/legal-consent'
import { authorizeBillingFromEntitlement } from '@loora/billing/billing'
import { resolveMcpUsagePlan } from '@loora/billing/mcp-usage'

export class AccessDeniedError extends Error {}

// Mirrors the oRPC protectedProcedure gates (packages/rpc/src/router.ts): a
// valid OAuth token is not enough, the user also needs preview access and an
// active plan.
export async function requireAppAccess(userId: string) {
  const [found] = await db
    .select({
      account: {
        id: user.id,
        isAdmin: user.isAdmin,
        previewAccess: user.previewAccess,
        acceptedTerms: user.acceptedTerms,
        acceptedPrivacy: user.acceptedPrivacy,
        termsAcceptedAt: user.termsAcceptedAt,
        privacyAcceptedAt: user.privacyAcceptedAt,
        termsVersion: user.termsVersion,
        privacyVersion: user.privacyVersion,
        mcpWeeklyLimit: user.mcpWeeklyLimit,
        mcpUsageResetAt: user.mcpUsageResetAt,
      },
      entitlement: {
        accessGranted: billingEntitlement.accessGranted,
        plan: billingEntitlement.plan,
        subscriptionStatus: billingEntitlement.subscriptionStatus,
        currentPeriodEnd: billingEntitlement.currentPeriodEnd,
        trialEnd: billingEntitlement.trialEnd,
      },
    })
    .from(user)
    .leftJoin(
      billingEntitlement,
      eq(billingEntitlement.userId, user.id),
    )
    .where(eq(user.id, userId))
    .limit(1)
  if (!found) throw new AccessDeniedError('Unknown user.')
  const { account, entitlement } = found
  if (!hasAcceptedCurrentLegal(account)) {
    throw new AccessDeniedError('The current Terms of Service and Privacy Policy must be accepted.')
  }
  if (!canUseApp(account)) throw new AccessDeniedError('Preview access is required.')
  const billing = authorizeBillingFromEntitlement(account, entitlement)
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
  return {
    account,
    mcpPlan,
    mcpUsageOptions: {
      weeklyLimit: account.mcpWeeklyLimit,
      resetAt: account.mcpUsageResetAt,
    },
  }
}
