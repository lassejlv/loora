import { createFileRoute } from '@tanstack/react-router'
import { AppearanceSettings } from '@loora/shell/appearance-settings'
import { AppPageShell } from '@loora/shell/app-page-shell'
import { seo } from '#/lib/seo'

export const Route = createFileRoute('/app/appearance')({
  component: AppearancePage,
  ssr: false,
  head: () =>
    seo({
      title: 'Appearance — Loora',
      description: 'Theme and interface size.',
      noindex: true,
    }),
})

function AppearancePage() {
  return (
    <AppPageShell
      title="Appearance"
      description="Theme and interface size for this browser."
    >
      <AppearanceSettings />
    </AppPageShell>
  )
}
