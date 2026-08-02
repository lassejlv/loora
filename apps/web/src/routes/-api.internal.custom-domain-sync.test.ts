import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const syncPublishedSiteDomains = vi.fn()
const originalToken = process.env.CUSTOM_DOMAIN_SYNC_TOKEN

vi.mock('@loora/rpc/publish-domain-sync', () => ({
  syncPublishedSiteDomains: (...args: unknown[]) =>
    syncPublishedSiteDomains(...args),
}))

afterEach(() => {
  if (originalToken === undefined) delete process.env.CUSTOM_DOMAIN_SYNC_TOKEN
  else process.env.CUSTOM_DOMAIN_SYNC_TOKEN = originalToken
})

describe('custom-domain sync route', () => {
  beforeEach(() => {
    process.env.CUSTOM_DOMAIN_SYNC_TOKEN = 'internal-test-secret'
    syncPublishedSiteDomains.mockReset().mockResolvedValue({
      enabled: true,
      configured: true,
      checked: 2,
      active: 1,
      failed: 0,
    })
  })

  it('rejects requests without the internal bearer token', async () => {
    const { customDomainSyncResponse } = await import(
      './api.internal.custom-domain-sync'
    )
    const response = await customDomainSyncResponse(
      new Request('http://localhost/api/internal/custom-domain-sync', {
        method: 'POST',
      }),
    )
    expect(response.status).toBe(401)
    expect(syncPublishedSiteDomains).not.toHaveBeenCalled()
  })

  it('refreshes eligible domains for an authorized Worker', async () => {
    const { customDomainSyncResponse } = await import(
      './api.internal.custom-domain-sync'
    )
    const response = await customDomainSyncResponse(
      new Request('http://localhost/api/internal/custom-domain-sync', {
        method: 'POST',
        headers: { authorization: 'Bearer internal-test-secret' },
      }),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      checked: 2,
      active: 1,
    })
  })

  it('treats the global kill switch as a healthy no-op', async () => {
    syncPublishedSiteDomains.mockResolvedValue({
      enabled: false,
      configured: true,
      checked: 0,
      active: 0,
      failed: 0,
    })
    const { customDomainSyncResponse } = await import(
      './api.internal.custom-domain-sync'
    )
    const response = await customDomainSyncResponse(
      new Request('http://localhost/api/internal/custom-domain-sync', {
        method: 'POST',
        headers: { authorization: 'Bearer internal-test-secret' },
      }),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ enabled: false })
  })
})
