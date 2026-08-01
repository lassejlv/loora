import { createFileRoute } from '@tanstack/react-router'
import { AdminPanel } from '@loora/shell/admin/admin-panel'
import { AppPageShell } from '@loora/shell/app-page-shell'
import { DesktopGate } from '#app/components/desktop-gate'

export const Route = createFileRoute('/app/admin')({ component: AdminPage })

function AdminPage() {
  return (
    <DesktopGate>
      <AppPageShell
        active="admin"
        wide
        title="Admin"
        description="Accounts, access, usage, and takedowns across the whole workspace."
      >
        <AdminPanel />
      </AppPageShell>
    </DesktopGate>
  )
}
