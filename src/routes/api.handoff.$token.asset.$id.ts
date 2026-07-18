import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { and, eq } from 'drizzle-orm'
import { db } from '#/db'
import { asset } from '#/db/schema'
import { getHandoffDesign, referencedAssetIds } from '#/lib/handoff'
import { s3 } from '#/lib/storage'

export const Route = createFileRoute('/api/handoff/$token/asset/$id')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const handoff = await getHandoffDesign(params.token)
        if (!handoff || !referencedAssetIds(handoff.shapes).has(params.id)) {
          return new Response('Not found', { status: 404 })
        }

        const [found] = await db
          .select({
            data: asset.data,
            storageKey: asset.storageKey,
            mediaType: asset.mediaType,
            name: asset.name,
          })
          .from(asset)
          .where(and(eq(asset.id, params.id), eq(asset.userId, handoff.userId)))
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

        const filename = found.name.replace(/["\\\r\n]/g, '_')
        return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]), {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
            'Content-Disposition': `attachment; filename="${filename}"`,
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
