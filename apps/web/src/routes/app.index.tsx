import { createFileRoute } from '@tanstack/react-router'
import { AccountGate } from '@loora/shell/account-gate'
import { DesignsDashboard } from '@loora/shell/designs-dashboard'

export const Route = createFileRoute('/app/')({
  component: FilesPage,
  ssr: false,
})

function FilesPage() {
  return (
    <AccountGate>
      <DesignsDashboard />
    </AccountGate>
  )
}
