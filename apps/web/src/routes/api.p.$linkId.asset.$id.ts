import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { and, eq } from 'drizzle-orm'
import { db } from '@loora/db'
import { asset } from '@loora/db/schema'
import { referencedAssetIds } from '@loora/rpc/handoff'
import {
  getPublishedElement,
  publishEgressExceeded,
  recordPublishEgress,
} from '@loora/rpc/publish'
import { s3 } from '@loora/rpc/storage'

export const Route = createFileRoute('/api/p/$linkId/asset/$id')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const published = await getPublishedElement(params.linkId)
        // Only assets the published element actually references are servable —
        // the link is not a key to the owner's whole asset library.
        if (!published || !referencedAssetIds([published.element]).has(params.id)) {
          return new Response('Not found', { status: 404 })
        }
        // Egress check before touching the asset, so an over-limit page never
        // costs an S3 read.
        if (await publishEgressExceeded(published.userId, published.isAdmin)) {
          return new Response('Bandwidth limit reached', { status: 429 })
        }

        const [found] = await db
          .select({
            data: asset.data,
            storageKey: asset.storageKey,
            mediaType: asset.mediaType,
          })
          .from(asset)
          .where(and(eq(asset.id, params.id), eq(asset.userId, published.userId)))
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

        await recordPublishEgress(published.userId, bytes.byteLength)
        return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]), {
          headers: {
            // Short private cache: link lives at most 12h and content is
            // immutable per asset id in practice.
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
