import { createFileRoute } from '@tanstack/react-router'
import { AppPageShell } from '@loora/shell/app-page-shell'
import { BillingSettings } from '@loora/shell/billing-settings'
import { seo } from '#/lib/seo'

export const Route = createFileRoute('/app/billing')({
  component: BillingPage,
  ssr: false,
  head: () =>
    seo({
      title: 'Billing — Loora',
      description: 'Manage your Loora plan and subscription.',
      noindex: true,
    }),
})

function BillingPage() {
  return (
    <AppPageShell
      title="Billing"
      description="Manage your Loora plan, subscription, and Agent Calls."
    >
      <BillingSettings />
    </AppPageShell>
  )
}
