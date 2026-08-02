import { customDomainClient } from './publish-domain'
import { s3 } from './storage'

export interface PublishedSiteArtifact {
  customDomain: string | null
  storageKey: string
}

export async function cleanupPublishedSiteArtifacts(
  sites: PublishedSiteArtifact[],
  options: { strictCustomDomains?: boolean; logScope?: string } = {},
) {
  const logScope = options.logScope ?? 'publish'
  let domains: ReturnType<typeof customDomainClient> = null
  try {
    domains = customDomainClient()
  } catch (error) {
    if (options.strictCustomDomains) throw error
    console.error(`[${logScope}] Custom-domain client setup failed:`, error)
  }

  for (const site of sites) {
    if (site.customDomain) {
      try {
        if (!domains) {
          throw new Error('Cloudflare for SaaS is not configured')
        }
        await domains.remove(site.customDomain)
      } catch (error) {
        if (options.strictCustomDomains) throw error
        console.error(
          `[${logScope}] Custom-domain cleanup failed for ${site.customDomain}:`,
          error,
        )
      }
    }

    if (s3) {
      await s3
        .delete(site.storageKey)
        .catch((error) =>
          console.error(`[${logScope}] Published-site S3 cleanup failed:`, error),
        )
    }
  }
}
