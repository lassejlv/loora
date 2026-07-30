import { createFileRoute } from '@tanstack/react-router'
import { AccountGate } from '#/components/account-gate'
import { AppPageShell } from '#/components/app-page-shell'
import { BillingSettings } from '#/components/billing-settings'

export const Route = createFileRoute('/app/billing')({
  component: BillingPage,
  ssr: false,
})

function BillingPage() {
  return (
    <AccountGate>
      <AppPageShell
        active="billing"
        title="Billing"
        description="Manage your Loora plan and subscription."
      >
        <BillingSettings />
      </AppPageShell>
    </AccountGate>
  )
}
