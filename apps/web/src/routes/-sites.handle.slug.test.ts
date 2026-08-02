import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadPublishedSiteHtml = vi.fn()
const rateLimit = vi.fn()

vi.mock('@loora/rpc/publish-procedures', () => ({
  loadPublishedSiteHtml: (...args: unknown[]) => loadPublishedSiteHtml(...args),
}))

vi.mock('@loora/rpc/rate-limit', () => ({
  callerIdentity: () => 'ip:test',
  rateLimit: (...args: unknown[]) => rateLimit(...args),
  rateLimits: { publishedSite: { limit: 240, windowMs: 60_000 } },
}))

describe('Published site route', () => {
  beforeEach(() => {
    loadPublishedSiteHtml.mockReset()
    rateLimit.mockReset()
    rateLimit.mockResolvedValue({ ok: true })
  })

  it('returns 404 when the site is missing', async () => {
    loadPublishedSiteHtml.mockResolvedValue(null)
    const { publishedSiteResponse } = await import('./sites.$handle.$slug')
    const response = await publishedSiteResponse(
      new Request('http://localhost/sites/lasse/home'),
      { handle: 'lasse', slug: 'home' },
    )
    expect(response.status).toBe(404)
  })

  it('streams HTML for a published site', async () => {
    loadPublishedSiteHtml.mockResolvedValue({
      html: '<!doctype html><title>Home</title>',
      title: 'Home',
    })
    const { publishedSiteResponse } = await import('./sites.$handle.$slug')
    const response = await publishedSiteResponse(
      new Request('http://localhost/sites/lasse/home'),
      { handle: 'lasse', slug: 'home' },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/html')
    expect(await response.text()).toContain('<!doctype html>')
  })

  it('rate-limits anonymous readers', async () => {
    rateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 12 })
    const { publishedSiteResponse } = await import('./sites.$handle.$slug')
    const response = await publishedSiteResponse(
      new Request('http://localhost/sites/lasse/home'),
      { handle: 'lasse', slug: 'home' },
    )
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('12')
  })
})
