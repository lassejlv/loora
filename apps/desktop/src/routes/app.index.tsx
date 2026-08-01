import { createFileRoute } from '@tanstack/react-router'
import { DesignsDashboard } from '@loora/shell/designs-dashboard'
import { DesktopGate } from '#app/components/desktop-gate'

export const Route = createFileRoute('/app/')({ component: FilesPage })

function FilesPage() {
  return (
    <DesktopGate>
      <DesignsDashboard />
    </DesktopGate>
  )
}
