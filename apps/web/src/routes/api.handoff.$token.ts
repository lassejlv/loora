import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { buildHandoffPayload } from '@loora/rpc/handoff'
import { callerIdentity, rateLimit, rateLimits } from '@loora/rpc/rate-limit'

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
        // The token is the whole authorization here, so guessing at one has to
        // cost something. Counted per address, before the lookup.
        const decision = await rateLimit(
          'handoff',
          callerIdentity(request.headers),
          rateLimits.handoff,
        )
        if (!decision.ok) {
          return new Response(
            JSON.stringify({ error: 'Too many requests. Try again shortly.' }),
            { status: 429, headers: { ...publicHeaders, 'Retry-After': String(decision.retryAfterSeconds) } },
          )
        }
        const payload = await buildHandoffPayload(params.token, new URL(request.url).origin)
        if (!payload) return Response.json({ error: 'Handoff not found or expired.' }, { status: 404, headers: publicHeaders })
        return Response.json(payload, { headers: publicHeaders })
      },
      OPTIONS: () => new Response(null, { status: 204, headers: publicHeaders }),
    },
  },
})
