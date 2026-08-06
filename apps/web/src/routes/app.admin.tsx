import { createFileRoute } from '@tanstack/react-router'
import { AdminPanel } from '@loora/shell/admin/admin-panel'
import { AppPageShell } from '@loora/shell/app-page-shell'
import { seo } from '#/lib/seo'

export const Route = createFileRoute('/app/admin')({
  component: AdminPage,
  ssr: false,
  head: () =>
    seo({
      title: 'Admin — Loora',
      description: 'Staff panel.',
      noindex: true,
    }),
})

function AdminPage() {
  return (
    <AppPageShell
      wide
      title="Admin"
      description="Accounts, access, usage, and takedowns across the whole workspace."
    >
      <AdminPanel />
    </AppPageShell>
  )
}
