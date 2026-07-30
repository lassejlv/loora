import { createFileRoute } from '@tanstack/react-router'
import { AccountGate } from '#/components/account-gate'
import { AppPageShell } from '#/components/app-page-shell'
import { IntegrationsSettings } from '#/components/integrations-settings'
import { integrationsValidateSearch } from '#/lib/url-state'

export const Route = createFileRoute('/app/integrations')({
  component: IntegrationsPage,
  ssr: false,
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
