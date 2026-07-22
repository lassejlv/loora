import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { buildPublishPayload } from '@loora/rpc/publish'

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
        const payload = await buildPublishPayload(params.linkId)
        if (!payload) {
          return Response.json(
            { error: 'This link has expired or was removed.' },
            { status: 404, headers: publicHeaders },
          )
        }
        return Response.json(payload, { headers: publicHeaders })
      },
    },
  },
})
