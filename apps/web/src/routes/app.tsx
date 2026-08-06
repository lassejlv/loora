import { Outlet, createFileRoute } from '@tanstack/react-router'
import { AccountGate } from '@loora/shell/account-gate'
import { AppShell } from '@loora/shell/app-page-shell'

export const Route = createFileRoute('/app')({
  component: AppLayout,
  ssr: false,
})

function AppLayout() {
  return (
    <AccountGate>
      <AppShell>
        <Outlet />
      </AppShell>
    </AccountGate>
  )
}
