import {
  and,
  eq,
  isNotNull,
} from 'drizzle-orm'
import { ORPCError, os } from '@orpc/server'
import { z } from 'zod'
import { googleOAuthEnabled } from '@loora/auth'
import { db } from '@loora/db'
import {
  asset,
  user,
} from '@loora/db/schema'
import { canUseApp, isPreviewAccessRequired } from '@loora/auth/preview-access'
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  hasAcceptedCurrentLegal,
} from '@loora/auth/legal-consent'
import { githubEnabled } from '@loora/auth/github'
import { s3 } from './storage'
import {
  consentedProcedure,
  signedInProcedure,
} from './procedures'

/**
 * The `auth` namespace: what the client needs to know about sign-in, the
 * consent and preview gates, and deleting an account outright.
 */

export const getAuthConfig = os.handler(() => ({ googleOAuthEnabled, githubEnabled }))

export const getLegalConsent = signedInProcedure.handler(async ({ context }) => {
  const [account] = await db
    .select({
      acceptedTerms: user.acceptedTerms,
      acceptedPrivacy: user.acceptedPrivacy,
      termsAcceptedAt: user.termsAcceptedAt,
      privacyAcceptedAt: user.privacyAcceptedAt,
      termsVersion: user.termsVersion,
      privacyVersion: user.privacyVersion,
    })
    .from(user)
    .where(eq(user.id, context.user.id))
    .limit(1)

  if (!account) throw new ORPCError('UNAUTHORIZED')
  return {
    accepted: hasAcceptedCurrentLegal(account),
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION,
  }
})

export const acceptLegal = signedInProcedure
  .input(
    z.object({
      acceptedTerms: z.literal(true),
      acceptedPrivacy: z.literal(true),
    }),
  )
  .handler(async ({ context }) => {
    const acceptedAt = new Date()
    const [account] = await db
      .update(user)
      .set({
        acceptedTerms: true,
        acceptedPrivacy: true,
        termsAcceptedAt: acceptedAt,
        privacyAcceptedAt: acceptedAt,
        termsVersion: CURRENT_TERMS_VERSION,
        privacyVersion: CURRENT_PRIVACY_VERSION,
        updatedAt: acceptedAt,
      })
      .where(eq(user.id, context.user.id))
      .returning({ id: user.id })

    if (!account) throw new ORPCError('UNAUTHORIZED')
    return {
      accepted: true,
      termsVersion: CURRENT_TERMS_VERSION,
      privacyVersion: CURRENT_PRIVACY_VERSION,
    }
  })

export const getPreviewAccess = consentedProcedure.handler(async ({ context }) => {
  const [account] = await db
    .select({
      isAdmin: user.isAdmin,
      previewAccess: user.previewAccess,
      previewAccessRequestedAt: user.previewAccessRequestedAt,
    })
    .from(user)
    .where(eq(user.id, context.user.id))
    .limit(1)

  if (!account) throw new ORPCError('UNAUTHORIZED')
  const required = isPreviewAccessRequired()
  return {
    required,
    granted: canUseApp(account, required),
    requested: account.previewAccessRequestedAt !== null,
  }
})

export const requestPreviewAccess = consentedProcedure.handler(async ({ context }) => {
  if (!isPreviewAccessRequired() || canUseApp(context.user)) {
    return { requested: false, granted: true }
  }

  await db
    .update(user)
    .set({ previewAccessRequestedAt: new Date(), updatedAt: new Date() })
    .where(eq(user.id, context.user.id))

  return { requested: true, granted: false }
})

export async function deleteUserAccountData(userId: string) {
  // S3 objects don't cascade with the user row; collect and delete them first.
  if (s3) {
    const keys = await db
      .select({ storageKey: asset.storageKey })
      .from(asset)
      .where(and(eq(asset.userId, userId), isNotNull(asset.storageKey)))
    for (const { storageKey } of keys) {
      if (storageKey) {
        await s3
          .delete(storageKey)
          .catch((error) => console.error('[account] S3 delete failed:', error))
      }
    }
  }

  // Everything else (designs, drafts, sessions, oauth tokens) cascades.
  await db.delete(user).where(eq(user.id, userId))
}

export const deleteAccount = consentedProcedure.handler(async ({ context }) => {
  await deleteUserAccountData(context.user.id)
  return { deleted: true }
})
