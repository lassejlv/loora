import { createFileRoute } from '@tanstack/react-router'
import { AccountGate } from '#/components/account-gate'
import { DesignsDashboard } from '#/components/designs-dashboard'

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
