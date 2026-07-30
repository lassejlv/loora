import { useEffect, useState } from 'react'
import { authClient } from '@loora/auth/client'
import { Button } from '#/components/ui/button'
import { PanelLoading } from '#/components/panel-shell'
import { orpc } from '#/lib/orpc-client'

type BillingStatus = Awaited<ReturnType<typeof orpc.billing.status>>

export function BillingSettings() {
  const { data: session } = authClient.useSession()
  const [billing, setBilling] = useState<BillingStatus | null>(null)
  const [error, setError] = useState('')
  const [openingPortal, setOpeningPortal] = useState(false)

  const load = async () => {
    try {
      setBilling(await orpc.billing.status())
      setError('')
    } catch {
      setError('Could not load billing.')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  if (session?.user.isAdmin) {
    return (
      <div>
        <h2 className="text-sm font-semibold">Internal access</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Admin accounts bypass subscriptions and keep full editor access.
        </p>
      </div>
    )
  }

  if (!billing && !error) return <PanelLoading label="Loading billing…" />

  if (!billing) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-xs text-destructive-foreground">{error}</p>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    )
  }

  if (!billing.required) {
    return (
      <div>
        <h2 className="text-sm font-semibold">Billing is disabled</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          This Loora environment does not require a subscription.
        </p>
      </div>
    )
  }

  const plan = billing.trial
    ? 'Pro trial'
    : billing.plan === 'studio'
      ? 'Studio (legacy)'
      : billing.plan === 'pro'
        ? 'Pro'
        : billing.plan === 'free'
          ? 'Free'
          : 'No plan'

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-lg border border-border p-4">
        <p className="text-xs text-muted-foreground">Current plan</p>
        <p className="mt-1 text-lg font-semibold">{plan}</p>
        {billing.trial ? (
          <div className="mt-3 rounded-md bg-secondary px-3 py-2 text-xs">
            <p>Your trial ends {new Date(billing.trial.endsAt).toLocaleDateString()}.</p>
            <p className="mt-1 text-muted-foreground">
              Full canvas, branches, exports, and the MCP server are included for the whole trial.
            </p>
          </div>
        ) : null}
        {billing.cancelAtPeriodEnd && billing.currentPeriodEnd ? (
          <p className="mt-3 rounded-md bg-secondary px-3 py-2 text-xs">
            Your plan ends {new Date(billing.currentPeriodEnd).toLocaleDateString()}.
            Access remains active until then.
          </p>
        ) : null}
      </div>
      <div className="flex flex-col items-start gap-2">
        <Button
          variant="outline"
          disabled={openingPortal || !billing.plan}
          onClick={async () => {
            setOpeningPortal(true)
            setError('')
            try {
              await authClient.customer.portal()
            } catch {
              setError('Could not open the billing portal.')
              setOpeningPortal(false)
            }
          }}
        >
          {openingPortal ? 'Opening portal…' : 'Manage billing'}
        </Button>
        {error ? <p className="text-xs text-destructive-foreground">{error}</p> : null}
      </div>
    </div>
  )
}
