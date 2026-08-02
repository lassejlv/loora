import { createFileRoute } from '@tanstack/react-router'
import { AccountGate } from '@loora/shell/account-gate'
import { AppPageShell } from '@loora/shell/app-page-shell'
import { IntegrationsSettings } from '@loora/shell/integrations-settings'
import { integrationsValidateSearch } from '@loora/shell/lib/url-state'
import { seo } from '#/lib/seo'

export const Route = createFileRoute('/app/integrations')({
  component: IntegrationsPage,
  ssr: false,
  head: () =>
    seo({
      title: 'Integrations — Loora',
      description: 'Connected agents and external accounts.',
      noindex: true,
    }),
  validateSearch: integrationsValidateSearch,
})

function IntegrationsPage() {
  return (
    <AccountGate>
      <AppPageShell
        active="integrations"
        title="Integrations"
        description="Connect external accounts and agents to Loora."
      >
        <IntegrationsSettings />
      </AppPageShell>
    </AccountGate>
  )
}
