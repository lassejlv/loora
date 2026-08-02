import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadPublishedSiteHtmlByDomain = vi.fn()
const rateLimit = vi.fn()

vi.mock('@loora/rpc/publish-procedures', () => ({
  loadPublishedSiteHtmlByDomain: (...args: unknown[]) =>
    loadPublishedSiteHtmlByDomain(...args),
}))

vi.mock('@loora/rpc/rate-limit', () => ({
  callerIdentity: () => 'ip:test',
  rateLimit: (...args: unknown[]) => rateLimit(...args),
  rateLimits: { publishedSite: { limit: 240, windowMs: 60_000 } },
}))

describe('custom-domain published site route', () => {
  beforeEach(() => {
    loadPublishedSiteHtmlByDomain.mockReset()
    rateLimit.mockReset().mockResolvedValue({ ok: true })
  })

  it('only accepts the Worker forwarding contract', async () => {
    const { customDomainSiteResponse } = await import('./api.custom-domain-site')
    const response = await customDomainSiteResponse(
      new Request('http://localhost/api/custom-domain-site', {
        headers: { 'x-forwarded-host': 'site.example.com' },
      }),
    )
    expect(response.status).toBe(404)
    expect(loadPublishedSiteHtmlByDomain).not.toHaveBeenCalled()
  })

  it('loads the active site for the forwarded hostname', async () => {
    loadPublishedSiteHtmlByDomain.mockResolvedValue({
      html: '<!doctype html><title>Custom site</title>',
      title: 'Custom site',
    })
    const { customDomainSiteResponse } = await import('./api.custom-domain-site')
    const response = await customDomainSiteResponse(
      new Request('http://localhost/api/custom-domain-site', {
        headers: {
          'x-loora-custom-domain': 'true',
          'x-forwarded-host': 'Site.Example.com',
        },
      }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(loadPublishedSiteHtmlByDomain).toHaveBeenCalledWith('site.example.com')
  })

  it('rate-limits custom-domain readers', async () => {
    rateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 9 })
    const { customDomainSiteResponse } = await import('./api.custom-domain-site')
    const response = await customDomainSiteResponse(
      new Request('http://localhost/api/custom-domain-site', {
        headers: {
          'x-loora-custom-domain': 'true',
          'x-forwarded-host': 'site.example.com',
        },
      }),
    )
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('9')
  })
})
