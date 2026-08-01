import { INTEGRATION_TABS, type IntegrationTab } from '@loora/shell/lib/url-state'

/**
 * The editor used to live at `/`, and settings used to be search params on it.
 * Old links still arrive here, so `/` resolves them to a canonical route before
 * it renders the landing page.
 *
 * Returned as a descriptor rather than thrown so the mapping stays testable and
 * the route keeps TanStack's literal-typed `redirect` calls.
 */
export type LegacyLandingTarget =
  | { to: '/app/billing' }
  | { to: '/app/integrations'; integration: IntegrationTab | null }
  | { to: '/design/$id'; id: string }
  | { to: '/design/$id/b/$branchId'; id: string; branchId: string }

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null)

const integrationTab = (value: unknown): IntegrationTab | null => {
  const raw = str(value)
  return raw && (INTEGRATION_TABS as readonly string[]).includes(raw)
    ? (raw as IntegrationTab)
    : null
}

export function resolveLegacyLandingRedirect(search: unknown): LegacyLandingTarget | null {
  const params = (search ?? {}) as Record<string, unknown>

  // `?design=` and its short form `?d=` both named the open document.
  const id = str(params.design) ?? str(params.d)
  if (id) {
    // Drafts became branches; the id kept its meaning.
    const branchId = str(params.draft)
    return branchId ? { to: '/design/$id/b/$branchId', id, branchId } : { to: '/design/$id', id }
  }

  const settings = str(params.settings)
  if (settings === 'billing') return { to: '/app/billing' }

  // `?settings=github|mcp` predates the integrations screen and its tab param.
  const legacyTab = settings === 'github' || settings === 'mcp' ? (settings as IntegrationTab) : null
  if (settings === 'integrations' || legacyTab) {
    return {
      to: '/app/integrations',
      integration: legacyTab ?? (settings === 'integrations' ? integrationTab(params.integration) : null),
    }
  }

  return null
}
