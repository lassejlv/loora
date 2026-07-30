import { createFileRoute } from '@tanstack/react-router'
import { AccountGate } from '#/components/account-gate'
import { AdminPanel } from '#/components/admin/admin-panel'
import { AppPageShell } from '#/components/app-page-shell'

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
