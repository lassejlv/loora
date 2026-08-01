import { createFileRoute } from '@tanstack/react-router'
import { AppearanceSettings } from '@loora/shell/appearance-settings'
import { AppPageShell } from '@loora/shell/app-page-shell'
import { DesktopGate } from '#app/components/desktop-gate'

export const Route = createFileRoute('/app/appearance')({
  component: AppearancePage,
})

function AppearancePage() {
  return (
    <DesktopGate>
      <AppPageShell
        active="appearance"
        title="Appearance"
        description="Theme and interface size for this app."
      >
        <AppearanceSettings />
      </AppPageShell>
    </DesktopGate>
  )
}
