import { eq } from 'drizzle-orm'
import { db } from '@loora/db'
import { user } from '@loora/db/schema'
import { canUseApp } from '@loora/auth/preview-access'
import { authorizeBilling } from '@loora/auth/billing'

export class AccessDeniedError extends Error {}

// Mirrors the oRPC protectedProcedure gates (packages/rpc/src/router.ts): a
// valid OAuth token is not enough, the user also needs preview access and an
// active plan.
export async function requireAppAccess(userId: string) {
  const [account] = await db.select().from(user).where(eq(user.id, userId)).limit(1)
  if (!account) throw new AccessDeniedError('Unknown user.')
  if (!canUseApp(account)) throw new AccessDeniedError('Preview access is required.')
  if (!(await authorizeBilling(account)).access) {
    throw new AccessDeniedError('An active Loora plan is required.')
  }
  return account
}
