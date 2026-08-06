import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { syncPublishedSiteDomains } from '@loora/rpc/publish-domain-sync'
import { hasValidBearerToken } from '#/lib/internal-auth'

export async function customDomainSyncResponse(request: Request) {
  if (!hasValidBearerToken(request, process.env.CUSTOM_DOMAIN_SYNC_TOKEN)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await syncPublishedSiteDomains()
  return Response.json(result, {
    status:
      result.enabled && !result.configured
        ? 503
        : result.failed > 0
          ? 502
          : 200,
    headers: { 'Cache-Control': 'no-store' },
  })
}

export const Route = createFileRoute('/api/internal/custom-domain-sync')({
  server: {
    handlers: {
      POST: ({ request }) => customDomainSyncResponse(request),
    },
  },
})
