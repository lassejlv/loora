import { createFileRoute } from '@tanstack/react-router'
import { AccountGate } from '@loora/shell/account-gate'
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
    <AccountGate>
      <AppPageShell
        active="billing"
        title="Billing"
        description="Manage your Loora plan, subscription, and MCP usage."
      >
        <BillingSettings />
      </AppPageShell>
    </AccountGate>
  )
}
