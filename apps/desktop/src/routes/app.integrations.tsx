import { createFileRoute } from '@tanstack/react-router'
import { AppPageShell } from '@loora/shell/app-page-shell'
import { IntegrationsSettings } from '@loora/shell/integrations-settings'
import { integrationsValidateSearch } from '@loora/shell/lib/url-state'

export const Route = createFileRoute('/app/integrations')({
  component: IntegrationsPage,
  validateSearch: integrationsValidateSearch,
})

function IntegrationsPage() {
  return (
    <AppPageShell
      title="Integrations"
      description="Connect external accounts and agents to Loora."
    >
      <IntegrationsSettings />
    </AppPageShell>
  )
}
