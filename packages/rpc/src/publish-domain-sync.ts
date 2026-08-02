import {
  and,
  asc,
  eq,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
} from 'drizzle-orm'
import { db } from '@loora/db'
import { publishedSite } from '@loora/db/schema'
import {
  customDomainClient,
  customDomainsEnabled,
  storedDomainState,
} from './publish-domain'

const PENDING_REFRESH_MS = 60 * 1000
const ACTIVE_REFRESH_MS = 15 * 60 * 1000
const SYNC_BATCH_SIZE = 25

export async function syncPublishedSiteDomains(now = new Date()) {
  if (!customDomainsEnabled()) {
    return {
      enabled: false,
      configured: true,
      checked: 0,
      active: 0,
      failed: 0,
    }
  }
  const client = customDomainClient()
  if (!client) {
    return {
      enabled: true,
      configured: false,
      checked: 0,
      active: 0,
      failed: 0,
    }
  }

  const pendingBefore = new Date(now.getTime() - PENDING_REFRESH_MS)
  const activeBefore = new Date(now.getTime() - ACTIVE_REFRESH_MS)
  const sites = await db
    .select({
      id: publishedSite.id,
      hostname: publishedSite.customDomain,
    })
    .from(publishedSite)
    .where(
      and(
        isNotNull(publishedSite.customDomain),
        or(
          isNull(publishedSite.customDomainUpdatedAt),
          isNull(publishedSite.customDomainStatus),
          and(
            ne(publishedSite.customDomainStatus, 'active'),
            lt(publishedSite.customDomainUpdatedAt, pendingBefore),
          ),
          and(
            eq(publishedSite.customDomainStatus, 'active'),
            lt(publishedSite.customDomainUpdatedAt, activeBefore),
          ),
        ),
      ),
    )
    .orderBy(asc(publishedSite.customDomainUpdatedAt))
    .limit(SYNC_BATCH_SIZE)

  let active = 0
  let failed = 0
  for (const site of sites) {
    if (!site.hostname) continue
    try {
      const domain = await client.refresh(site.hostname)
      await db
        .update(publishedSite)
        .set(storedDomainState(domain))
        .where(
          and(
            eq(publishedSite.id, site.id),
            eq(publishedSite.customDomain, site.hostname),
          ),
        )
      if (domain.status === 'active') active += 1
    } catch (error) {
      failed += 1
      console.error(
        `[custom-domain-sync] Refresh failed for ${site.hostname}:`,
        error,
      )
    }
  }

  return {
    enabled: true,
    configured: true,
    checked: sites.length,
    active,
    failed,
  }
}
