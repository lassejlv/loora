import { loadPublishedSiteHtmlByDomain } from '@loora/rpc/publish-procedures'
import { callerIdentity, rateLimit, rateLimits } from '@loora/rpc/rate-limit'

const responseHeaders = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

export function forwardedCustomDomain(headers: Headers) {
  if (headers.get('x-loora-custom-domain') !== 'true') return null
  const raw = headers.get('x-forwarded-host')?.split(',').at(-1)?.trim()
  if (!raw) return null
  try {
    return new URL(`https://${raw}`).hostname.toLowerCase()
  } catch {
    return null
  }
}

export async function handleCustomDomainSiteRequest(request: Request) {
  const domain = forwardedCustomDomain(request.headers)
  if (!domain) {
    return new Response('Published site not found.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

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

  const site = await loadPublishedSiteHtmlByDomain(domain)
  if (!site) {
    return new Response('Published site not found.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
  return new Response(site.html, { status: 200, headers: responseHeaders })
}

export async function handleCustomDomainSiteHeadRequest(request: Request) {
  const response = await handleCustomDomainSiteRequest(request)
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  })
}
