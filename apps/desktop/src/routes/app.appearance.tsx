import { createFileRoute } from '@tanstack/react-router'
import { AppearanceSettings } from '@loora/shell/appearance-settings'
import { AppPageShell } from '@loora/shell/app-page-shell'

export const Route = createFileRoute('/app/appearance')({
  component: AppearancePage,
})

function AppearancePage() {
  return (
    <AppPageShell
      title="Appearance"
      description="Theme and interface size for this app."
    >
      <AppearanceSettings />
    </AppPageShell>
  )
}
