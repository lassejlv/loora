import { createFileRoute } from '@tanstack/react-router'
import { DesignsDashboard } from '@loora/shell/designs-dashboard'
import { seo } from '#/lib/seo'

export const Route = createFileRoute('/app/')({
  component: FilesPage,
  ssr: false,
  head: () =>
    seo({
      title: 'Your designs — Loora',
      description: 'Your Loora design files.',
      noindex: true,
    }),
})

function FilesPage() {
  return <DesignsDashboard />
}
