import { createFileRoute } from '@tanstack/react-router'
import { loadPublishedSiteHtml } from '@loora/rpc/publish-procedures'
import { callerIdentity, rateLimit, rateLimits } from '@loora/rpc/rate-limit'

const headers = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'public, max-age=3600',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

export async function publishedSiteResponse(
  request: Request,
  params: { handle: string; slug: string },
) {
  const decision = await rateLimit(
    'publishedSite',
    callerIdentity(request.headers),
    rateLimits.publishedSite,
  )
  if (!decision.ok) {
    return new Response('Too many requests. Try again shortly.', {
      status: 429,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Retry-After': String(decision.retryAfterSeconds),
      },
    })
  }

  const site = await loadPublishedSiteHtml(params.handle, params.slug)
  if (!site) {
    return new Response('Published site not found.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  return new Response(site.html, { status: 200, headers })
}

export const Route = createFileRoute('/sites/$handle/$slug')({
  server: {
    handlers: {
      GET: async ({ request, params }) =>
        publishedSiteResponse(request, params),
    },
  },
})
