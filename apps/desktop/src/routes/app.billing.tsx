import { createFileRoute } from '@tanstack/react-router'
import { AppPageShell } from '@loora/shell/app-page-shell'
import { BillingSettings } from '@loora/shell/billing-settings'
import { DesktopGate } from '#app/components/desktop-gate'

export const Route = createFileRoute('/app/billing')({ component: BillingPage })

function BillingPage() {
  return (
    <DesktopGate>
      <AppPageShell
        active="billing"
        title="Billing"
        description="Manage your Loora plan, subscription, and MCP usage."
      >
        <BillingSettings />
      </AppPageShell>
    </DesktopGate>
  )
}
