import {
  createDomainClient,
  DomainSdkError,
  normalizeHostname,
  type Domain,
  type DomainClient,
} from '@opencoredev/domain-sdk'
import { cloudflareSaaS } from '@opencoredev/domain-sdk/cloudflare'
import { ORPCError } from '@orpc/server'
import { getDomain } from 'tldts'
import { authorizeBilling } from '@loora/billing/billing'
import type {
  PublishedSiteDomainRecord,
  PublishedSiteDomainStatus,
} from '@loora/db/schema'

type BillingDecision = Awaited<ReturnType<typeof authorizeBilling>>

export function billingIncludesCustomDomains(billing: BillingDecision) {
  if (billing.source === 'admin' || billing.source === 'disabled') return true
  return (
    billing.access &&
    (billing.entitlement?.plan === 'pro' ||
      billing.entitlement?.plan === 'studio')
  )
}

export async function canUseCustomDomains(user: {
  id: string
  isAdmin?: boolean | null
}) {
  return billingIncludesCustomDomains(await authorizeBilling(user))
}

export async function requireCustomDomainPlan(user: {
  id: string
  isAdmin?: boolean | null
}) {
  if (await canUseCustomDomains(user)) return
  throw new ORPCError('FORBIDDEN', {
    message: 'Custom domains require Loora Pro.',
  })
}

export function customDomainsEnabled() {
  const value = process.env.CUSTOM_DOMAINS_ENABLED?.trim().toLowerCase()
  return value !== 'false' && value !== '0'
}

export function requireCustomDomainsEnabled() {
  if (customDomainsEnabled()) return
  throw new ORPCError('FORBIDDEN', {
    message: 'Custom domains are currently disabled.',
  })
}

export function customDomainClient(): DomainClient | null {
  const apiToken = process.env.CLOUDFLARE_SAAS_API_TOKEN?.trim()
  const zoneId = process.env.CLOUDFLARE_SAAS_ZONE_ID?.trim()
  const cnameTarget = process.env.CLOUDFLARE_SAAS_CNAME_TARGET?.trim()
  if (!apiToken || !zoneId || !cnameTarget) return null

  return createDomainClient({
    provider: cloudflareSaaS({
      apiToken,
      zoneId,
      cnameTarget,
      customOriginServer:
        process.env.CLOUDFLARE_SAAS_ORIGIN?.trim() || undefined,
      ssl: { method: 'txt', type: 'dv', minimumTlsVersion: '1.2' },
    }),
  })
}

export function requireCustomDomainClient() {
  const client = customDomainClient()
  if (client) return client
  throw new ORPCError('INTERNAL_SERVER_ERROR', {
    message: 'Custom domains are not configured on this Loora deployment.',
  })
}

function appHostname() {
  const origin = process.env.BETTER_AUTH_URL?.trim()
  if (!origin) return null
  try {
    return new URL(origin).hostname.toLowerCase()
  } catch {
    return null
  }
}

export function normalizeCustomDomain(value: string) {
  let hostname: string
  try {
    hostname = normalizeHostname(value)
  } catch (error) {
    if (error instanceof DomainSdkError && error.code === 'INVALID_HOSTNAME') {
      throw new ORPCError('BAD_REQUEST', { message: error.message })
    }
    throw error
  }

  const ownHost = appHostname()
  const cnameTarget = process.env.CLOUDFLARE_SAAS_CNAME_TARGET
    ?.trim()
    .replace(/\.$/, '')
    .toLowerCase()
  if (
    hostname === cnameTarget ||
    (ownHost && (hostname === ownHost || hostname.endsWith(`.${ownHost}`)))
  ) {
    throw new ORPCError('BAD_REQUEST', {
      message: 'Choose a domain outside the Loora domain.',
    })
  }
  return hostname
}

export function customDomainDnsZone(hostname: string) {
  return getDomain(hostname, { allowPrivateDomains: true }) ?? hostname
}

export function requireCustomDomainHostnameSupported(
  client: Pick<DomainClient, 'capabilities'>,
  hostname: string,
) {
  if (
    !client.capabilities.apexDomains &&
    customDomainDnsZone(hostname) === hostname
  ) {
    throw new ORPCError('BAD_REQUEST', {
      message:
        'Root domains are not supported yet. Use a subdomain such as www.example.com.',
    })
  }
}

export function storedDomainState(domain: Domain) {
  const records: PublishedSiteDomainRecord[] = domain.records.map((record) => ({
    type: record.type,
    name: record.name,
    value: record.value,
    purpose: record.purpose,
    required: record.required,
    status: record.status,
  }))
  return {
    customDomainProviderId: domain.id,
    customDomainStatus: domain.status as PublishedSiteDomainStatus,
    customDomainRecords: records,
    customDomainUpdatedAt: new Date(),
  }
}

export function customDomainOrpcError(error: unknown): never {
  if (!(error instanceof DomainSdkError)) throw error
  if (error.code === 'INVALID_HOSTNAME') {
    throw new ORPCError('BAD_REQUEST', { message: error.message })
  }
  if (error.code === 'DOMAIN_CONFLICT') {
    throw new ORPCError('CONFLICT', {
      message: 'That domain is already connected elsewhere.',
    })
  }
  if (error.code === 'RATE_LIMITED') {
    throw new ORPCError('TOO_MANY_REQUESTS', {
      message: 'Cloudflare is rate limiting domain changes. Try again shortly.',
    })
  }
  if (error.code === 'INVALID_CONFIGURATION') {
    throw new ORPCError('INTERNAL_SERVER_ERROR', {
      message: 'Custom domains are not configured correctly.',
    })
  }
  throw new ORPCError('BAD_GATEWAY', {
    message: 'Cloudflare could not update this domain. Try again.',
  })
}
