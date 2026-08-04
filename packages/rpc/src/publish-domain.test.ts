import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Domain } from '@opencoredev/domain-sdk'
import {
  billingIncludesCustomDomains,
  customDomainDnsZone,
  customDomainsEnabled,
  normalizeCustomDomain,
  requireCustomDomainHostnameSupported,
  storedDomainState,
} from './publish-domain'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('published site custom domains', () => {
  it('limits custom domains to paid, admin, and billing-disabled accounts', () => {
    const decision = (
      source: 'cache' | 'admin' | 'disabled',
      plan: string | null,
      access = true,
    ) =>
      ({
        access,
        trial: false,
        source,
        entitlement: plan ? { plan } : null,
      }) as Parameters<typeof billingIncludesCustomDomains>[0]

    expect(billingIncludesCustomDomains(decision('cache', 'free'))).toBe(false)
    expect(billingIncludesCustomDomains(decision('cache', 'pro'))).toBe(true)
    expect(billingIncludesCustomDomains(decision('cache', 'studio'))).toBe(true)
    expect(billingIncludesCustomDomains(decision('cache', 'pro', false))).toBe(
      false,
    )
    expect(
      billingIncludesCustomDomains(decision('cache', 'studio', false)),
    ).toBe(false)
    expect(billingIncludesCustomDomains(decision('admin', null))).toBe(true)
    expect(billingIncludesCustomDomains(decision('disabled', null))).toBe(true)
  })

  it('normalizes customer hostnames and rejects Loora-owned names', () => {
    vi.stubEnv('BETTER_AUTH_URL', 'https://loora.design')
    vi.stubEnv('CLOUDFLARE_SAAS_CNAME_TARGET', 'cname.loora.design')

    expect(normalizeCustomDomain(' WWW.Example.com. ')).toBe('www.example.com')
    expect(() => normalizeCustomDomain('https://www.example.com')).toThrow(
      'protocols are not allowed',
    )
    expect(() => normalizeCustomDomain('sites.loora.design')).toThrow(
      'outside the Loora domain',
    )
  })

  it('supports a deployment-level custom-domain kill switch', () => {
    expect(customDomainsEnabled()).toBe(true)
    vi.stubEnv('CUSTOM_DOMAINS_ENABLED', 'false')
    expect(customDomainsEnabled()).toBe(false)
  })

  it('returns the authoritative DNS zone for provider-friendly record names', () => {
    expect(customDomainDnsZone('www.example.com')).toBe('example.com')
    expect(customDomainDnsZone('app.example.co.uk')).toBe('example.co.uk')
  })

  it('rejects apex domains when the configured provider cannot route them', () => {
    const client = {
      capabilities: { apexDomains: false },
    } as Parameters<typeof requireCustomDomainHostnameSupported>[0]

    expect(() =>
      requireCustomDomainHostnameSupported(client, 'example.com'),
    ).toThrow('Use a subdomain')
    expect(() =>
      requireCustomDomainHostnameSupported(client, 'www.example.com'),
    ).not.toThrow()
  })

  it('stores the provider-authoritative status and DNS records', () => {
    const state = storedDomainState({
      id: 'custom-hostname-id',
      hostname: 'www.example.com',
      provider: 'cloudflare',
      status: 'pending_certificate',
      records: [
        {
          type: 'CNAME',
          name: 'www.example.com',
          value: 'cname.loora.design',
          purpose: 'routing',
          required: true,
          status: 'valid',
        },
      ],
      verification: { status: 'verified', records: [] },
      certificate: { status: 'pending' },
      issues: [],
    } satisfies Domain)

    expect(state).toMatchObject({
      customDomainProviderId: 'custom-hostname-id',
      customDomainStatus: 'pending_certificate',
      customDomainRecords: [
        {
          type: 'CNAME',
          value: 'cname.loora.design',
          purpose: 'routing',
        },
      ],
    })
  })
})
