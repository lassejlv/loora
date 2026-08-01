import { createFileRoute } from '@tanstack/react-router'
import { AppPageShell } from '@loora/shell/app-page-shell'
import { IntegrationsSettings } from '@loora/shell/integrations-settings'
import { integrationsValidateSearch } from '@loora/shell/lib/url-state'
import { DesktopGate } from '#app/components/desktop-gate'

export const Route = createFileRoute('/app/integrations')({
  component: IntegrationsPage,
  validateSearch: integrationsValidateSearch,
})

function IntegrationsPage() {
  return (
    <DesktopGate>
      <AppPageShell
        active="integrations"
        title="Integrations"
        description="Connect external accounts and agents to Loora."
      >
        <IntegrationsSettings />
      </AppPageShell>
    </DesktopGate>
  )
}
