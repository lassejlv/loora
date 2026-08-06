import { Outlet, createFileRoute } from '@tanstack/react-router'
import { AppShell } from '@loora/shell/app-page-shell'
import { DesktopGate } from '#app/components/desktop-gate'

export const Route = createFileRoute('/app')({ component: AppLayout })

function AppLayout() {
  return (
    <DesktopGate>
      <AppShell>
        <Outlet />
      </AppShell>
    </DesktopGate>
  )
}
