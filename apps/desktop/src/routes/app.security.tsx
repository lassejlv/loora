import { createFileRoute } from '@tanstack/react-router'
import { AppPageShell } from '@loora/shell/app-page-shell'
import { SecuritySettings } from '@loora/shell/security-settings'
import { DesktopGate } from '#app/components/desktop-gate'

export const Route = createFileRoute('/app/security')({
  component: SecurityPage,
})

function SecurityPage() {
  return (
    <DesktopGate>
      <AppPageShell
        active="security"
        title="Security"
        description="Manage passkeys and account security."
      >
        <SecuritySettings />
      </AppPageShell>
    </DesktopGate>
  )
}