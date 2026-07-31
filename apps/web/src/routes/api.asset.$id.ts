import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { and, eq } from 'drizzle-orm'
import { db } from '@loora/db'
import { asset } from '@loora/db/schema'
import { requireSession } from '@loora/auth'
import { authorizeBilling, subscriptionRequiredResponse } from '@loora/billing/billing'
import { canUseApp, previewAccessRequiredResponse } from '@loora/auth/preview-access'
import {
  hasAcceptedCurrentLegal,
  legalConsentRequiredResponse,
} from '@loora/auth/legal-consent'
import { s3 } from '@loora/rpc/storage'
import {
  rateLimit,
  rateLimits,
  tooManyRequestsResponse,
} from '@loora/rpc/rate-limit'

export const Route = createFileRoute('/api/asset/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await requireSession(request)
        if (!session) return new Response('Unauthorized', { status: 401 })
        // Serving an asset means a row read and, usually, a bucket fetch, so
        // the count comes before either of them.
        const decision = await rateLimit(
          'asset',
          `user:${session.user.id}`,
          rateLimits.asset,
        )
        if (!decision.ok) return tooManyRequestsResponse(decision)

        if (!hasAcceptedCurrentLegal(session.user)) return legalConsentRequiredResponse()
        if (!canUseApp(session.user)) return previewAccessRequiredResponse()
        if (!(await authorizeBilling(session.user)).access) return subscriptionRequiredResponse()

        const [found] = await db
          .select({ data: asset.data, storageKey: asset.storageKey, mediaType: asset.mediaType })
          .from(asset)
          .where(and(eq(asset.id, params.id), eq(asset.userId, session.user.id)))
          .limit(1)

        if (!found) return new Response('Not found', { status: 404 })

        let bytes: Uint8Array
        if (found.storageKey && s3) {
          bytes = new Uint8Array(await s3.file(found.storageKey).arrayBuffer())
        } else if (found.data) {
          bytes = Uint8Array.from(atob(found.data), (c) => c.charCodeAt(0))
        } else {
          return new Response('Asset payload unavailable', { status: 500 })
        }
        return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]), {
          headers: {
            'Content-Type': found.mediaType,
            'Cache-Control': 'private, max-age=31536000, immutable',
          },
        })
      },
    },
  },
})
