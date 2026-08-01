import { createFileRoute } from '@tanstack/react-router'
import { AccountGate } from '@loora/shell/account-gate'
import { AdminPanel } from '@loora/shell/admin/admin-panel'
import { AppPageShell } from '@loora/shell/app-page-shell'

export const Route = createFileRoute('/app/admin')({
  component: AdminPage,
  ssr: false,
})

function AdminPage() {
  return (
    <AccountGate>
      <AppPageShell
        active="admin"
        wide
        title="Admin"
        description="Accounts, access, usage, and takedowns across the whole workspace."
      >
        <AdminPanel />
      </AppPageShell>
    </AccountGate>
  )
}
