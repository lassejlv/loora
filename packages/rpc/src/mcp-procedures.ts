import {
  and,
  desc,
  eq,
  isNotNull,
} from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@loora/db'
import {
  oauthAccessToken,
  oauthApplication,
  oauthConsent,
} from '@loora/db/schema'
import { summarizeMcpSessions } from './mcp-sessions'
import { consentedProcedure } from './procedures'

/**
 * The `mcp` namespace: which clients hold an authorization, and revoking one.
 */

export const listMcpSessions = consentedProcedure.handler(async ({ context }) => {
  const rows = await db
    .select({
      clientId: oauthAccessToken.clientId,
      clientName: oauthApplication.name,
      createdAt: oauthAccessToken.createdAt,
      updatedAt: oauthAccessToken.updatedAt,
      accessTokenExpiresAt: oauthAccessToken.accessTokenExpiresAt,
      refreshTokenExpiresAt: oauthAccessToken.refreshTokenExpiresAt,
    })
    .from(oauthAccessToken)
    .leftJoin(oauthApplication, eq(oauthAccessToken.clientId, oauthApplication.clientId))
    .where(
      and(
        eq(oauthAccessToken.userId, context.user.id),
        isNotNull(oauthAccessToken.clientId),
      ),
    )
    .orderBy(desc(oauthAccessToken.updatedAt))

  return summarizeMcpSessions(rows)
})

export const revokeMcpSession = consentedProcedure
  .input(z.object({ clientId: z.string().min(1).max(256) }))
  .handler(async ({ context, input }) => {
    const [tokens, consents] = await Promise.all([
      db
        .delete(oauthAccessToken)
        .where(
          and(
            eq(oauthAccessToken.userId, context.user.id),
            eq(oauthAccessToken.clientId, input.clientId),
          ),
        )
        .returning({ id: oauthAccessToken.id }),
      db
        .delete(oauthConsent)
        .where(
          and(
            eq(oauthConsent.userId, context.user.id),
            eq(oauthConsent.clientId, input.clientId),
          ),
        )
        .returning({ id: oauthConsent.id }),
    ])

    return { revoked: tokens.length > 0 || consents.length > 0 }
  })
