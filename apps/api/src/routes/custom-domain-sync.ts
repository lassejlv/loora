import { timingSafeEqual } from 'node:crypto'
import { syncPublishedSiteDomains } from '@loora/rpc/publish-domain-sync'

function authorized(request: Request) {
  const configured = process.env.CUSTOM_DOMAIN_SYNC_TOKEN?.trim()
  const supplied =
    request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
  if (!configured) return false
  const expected = Buffer.from(configured)
  const actual = Buffer.from(supplied)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export async function handleCustomDomainSyncRequest(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await syncPublishedSiteDomains()
  return Response.json(result, {
    status: result.enabled && !result.configured ? 503 : 200,
    headers: { 'Cache-Control': 'no-store' },
  })
}
