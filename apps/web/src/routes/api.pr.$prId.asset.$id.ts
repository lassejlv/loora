import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { and, eq } from 'drizzle-orm'
import { db } from '@loora/db'
import { asset } from '@loora/db/schema'
import { referencedAssetIds } from '@loora/rpc/handoff'
import { getReviewTarget, reviewShapes } from '@loora/rpc/pull-requests'
import { publishEgressExceeded, recordPublishEgress } from '@loora/rpc/publish'
import { s3 } from '@loora/rpc/storage'

export const Route = createFileRoute('/api/pr/$prId/asset/$id')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const review = await getReviewTarget(params.prId)
        // Only assets Main or the branch actually reference are servable — a
        // review link is not a key to the owner's asset library.
        if (!review || !referencedAssetIds(reviewShapes(review)).has(params.id)) {
          return new Response('Not found', { status: 404 })
        }
        if (await publishEgressExceeded(review.userId, review.isAdmin)) {
          return new Response('Bandwidth limit reached', { status: 429 })
        }

        const [found] = await db
          .select({ data: asset.data, storageKey: asset.storageKey, mediaType: asset.mediaType })
          .from(asset)
          .where(and(eq(asset.id, params.id), eq(asset.userId, review.userId)))
          .limit(1)
        if (!found) return new Response('Not found', { status: 404 })

        let bytes: Uint8Array
        if (found.storageKey && s3) {
          bytes = new Uint8Array(await s3.file(found.storageKey).arrayBuffer())
        } else if (found.data) {
          bytes = Uint8Array.from(atob(found.data), (character) => character.charCodeAt(0))
        } else {
          return new Response('Asset unavailable', { status: 404 })
        }

        await recordPublishEgress(review.userId, bytes.byteLength)
        return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]), {
          headers: {
            'Cache-Control': 'private, max-age=3600',
            'Content-Security-Policy': "sandbox; default-src 'none'",
            'Content-Type': found.mediaType,
            'Referrer-Policy': 'no-referrer',
            'X-Content-Type-Options': 'nosniff',
          },
        })
      },
    },
  },
})
