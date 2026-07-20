import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { buildHandoffPayload } from '@loora/rpc/handoff'

const publicHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

export const Route = createFileRoute('/api/handoff/$token')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const payload = await buildHandoffPayload(params.token, new URL(request.url).origin)
        if (!payload) return Response.json({ error: 'Handoff not found or expired.' }, { status: 404, headers: publicHeaders })
        return Response.json(payload, { headers: publicHeaders })
      },
      OPTIONS: () => new Response(null, { status: 204, headers: publicHeaders }),
    },
  },
})
