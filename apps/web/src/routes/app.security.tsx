import { createFileRoute } from '@tanstack/react-router'
import { AccountGate } from '@loora/shell/account-gate'
import { AppPageShell } from '@loora/shell/app-page-shell'
import { SecuritySettings } from '@loora/shell/security-settings'
import { seo } from '#/lib/seo'

export const Route = createFileRoute('/app/security')({
  component: SecurityPage,
  ssr: false,
  head: () =>
    seo({
      title: 'Security — Loora',
      description: 'Passkeys and account security.',
      noindex: true,
    }),
})

function SecurityPage() {
  return (
    <AccountGate>
      <AppPageShell
        active="security"
        title="Security"
        description="Manage passkeys and account security."
      >
        <SecuritySettings />
      </AppPageShell>
    </AccountGate>
  )
}