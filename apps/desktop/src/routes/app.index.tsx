import { createFileRoute } from '@tanstack/react-router'
import { DesignsDashboard } from '@loora/shell/designs-dashboard'

export const Route = createFileRoute('/app/')({ component: FilesPage })

function FilesPage() {
  return <DesignsDashboard />
}
