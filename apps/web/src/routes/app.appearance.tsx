import { createFileRoute } from '@tanstack/react-router'
import { AccountGate } from '#/components/account-gate'
import { AppearanceSettings } from '#/components/appearance-settings'
import { AppPageShell } from '#/components/app-page-shell'

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
