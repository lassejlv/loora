import { createFileRoute } from '@tanstack/react-router'
import { AccountGate } from '@loora/shell/account-gate'
import { AppearanceSettings } from '@loora/shell/appearance-settings'
import { AppPageShell } from '@loora/shell/app-page-shell'

export const Route = createFileRoute('/app/appearance')({
  component: AppearancePage,
  ssr: false,
})

function AppearancePage() {
  return (
    <AccountGate>
      <AppPageShell
        active="appearance"
        title="Appearance"
        description="Theme and interface size for this browser."
      >
        <AppearanceSettings />
      </AppPageShell>
    </AccountGate>
  )
}
