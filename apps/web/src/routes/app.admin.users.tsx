import { createFileRoute } from '@tanstack/react-router'
import { AccountGate } from '@loora/shell/account-gate'
import { AppPageShell } from '@loora/shell/app-page-shell'
import { authClient } from '@loora/auth/client'
import { AdminUsers } from '@loora/shell/admin/users'

export const Route = createFileRoute('/app/admin/users')({
  component: AdminUsersPage,
  ssr: false,
})

function AdminUsersPage() {
  const { data: session } = authClient.useSession()
  const userId = session?.user?.id ?? ''

  return (
    <AccountGate>
      <AppPageShell
        active="admin"
        wide
        title="Users"
        description="Every account on the workspace."
      >
        <AdminUsers currentUserId={userId} pendingRequests={0} onChanged={() => undefined} />
      </AppPageShell>
    </AccountGate>
  )
}