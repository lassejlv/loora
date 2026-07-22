import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import {
  buildPublishPayload,
  publishEgressExceeded,
  recordPublishEgress,
} from '@loora/rpc/publish'

const publicHeaders = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

export const Route = createFileRoute('/api/p/$linkId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const found = await buildPublishPayload(params.linkId)
        if (!found) {
          return Response.json(
            { error: 'This link has expired or was removed.' },
            { status: 404, headers: publicHeaders },
          )
        }
        if (await publishEgressExceeded(found.userId, found.isAdmin)) {
          return Response.json(
            { error: 'This page is temporarily unavailable — its bandwidth limit was reached.' },
            { status: 429, headers: publicHeaders },
          )
        }
        const body = JSON.stringify(found.payload)
        await recordPublishEgress(found.userId, new TextEncoder().encode(body).byteLength)
        return new Response(body, { headers: publicHeaders })
      },
    },
  },
})
