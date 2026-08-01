import { useCallback, useEffect, useState } from 'react'
import { LogOutIcon } from '@loora/ui/icons'
import { clearWelcomeSeen } from './welcome-dialog'
import { authClient } from '@loora/auth/client'
import { orpc } from '@loora/rpc/client'
import { openExternal } from '@loora/platform'
import { readAccessVerdict, writeAccessVerdict } from '../lib/access-cache'
import { Button } from '@loora/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@loora/ui/dialog'

type Plan = 'free' | 'pro'
type ProInterval = 'month' | 'year'
type BillingStatus = Awaited<ReturnType<typeof orpc.billing.status>>

interface SubscriptionScreenProps {
  userId: string
  children: React.ReactNode
  preview: React.ReactNode
  redirect?: (url: string) => void
}

const plans = [
  {
    id: 'free' as const,
    name: 'Free',
    price: '$0',
    summary: '50 files, 1 open branch per design, and 200 MCP calls a week',
    note: 'No card required',
  },
  {
    id: 'pro' as const,
    name: 'Pro',
    price: '$20',
    summary: 'Unlimited files and branches, 100 GB storage, and agent access',
    note: 'Save with yearly',
  },
]

export function SubscriptionScreen({ userId, children, preview, redirect }: SubscriptionScreenProps) {
  const [status, setStatus] = useState<BillingStatus | null>(null)
  // Last load's verdict: mounts the editor immediately for subscribed users
  // while the billing check re-runs. A live "no access" result wins.
  const [optimistic] = useState(() => readAccessVerdict('billing', userId))
  const [pending, setPending] = useState(true)
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)
  const [error, setError] = useState('')

  const loadStatus = useCallback(async (refresh = false) => {
    setPending(true)
    setError('')
    try {
      const next = refresh ? await orpc.billing.refresh() : await orpc.billing.status()
      setStatus(next)
      writeAccessVerdict('billing', userId, next.access)
      return next
    } catch {
      setError('Could not check your subscription. Please try again.')
      return null
    } finally {
      setPending(false)
    }
  }, [userId])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const completedCheckout = params.get('checkout') === 'success' && params.has('checkout_id')
    void loadStatus(completedCheckout).then(() => {
      if (!completedCheckout) return
      const url = new URL(window.location.href)
      url.searchParams.delete('checkout')
      url.searchParams.delete('checkout_id')
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    })
  }, [loadStatus])

  if (status ? status.access : optimistic) return children

  async function startCheckout(plan: Plan, interval: ProInterval = 'month') {
    setSelectedPlan(plan)
    setPending(true)
    setError('')
    try {
      const checkout = await orpc.billing.checkout(
        plan === 'pro' ? { plan, interval } : { plan },
      )
      const goToCheckout = redirect ?? openExternal
      goToCheckout(checkout.url)
    } catch {
      setError(`Could not open ${plan === 'free' ? 'Free' : 'Pro'} checkout. Please retry.`)
      setPending(false)
    }
  }

  // First billing check in flight: hold the shimmer instead of flashing the
  // plan picker at already-subscribed users.
  if (status === null && !error) {
    return (
      <main className="grid min-h-screen place-items-center bg-cx-canvas">
        <p className="cx-shimmer text-sm">Opening your canvas…</p>
      </main>
    )
  }

  return (
    <>
      <div aria-hidden="true" className="pointer-events-none select-none" inert>
        {preview}
      </div>
      <Dialog open onOpenChange={() => {}}>
        <DialogPopup className="sm:max-w-xl" showCloseButton={false}>
          <DialogHeader>
            <p className="mb-4 text-lg font-semibold tracking-tight">
              loora<span className="text-cx-accent">.</span>
            </p>
            <DialogTitle>Choose your Loora plan</DialogTitle>
            <DialogDescription>
              Free is the whole editor, not a demo. Pro lifts the limits — unlimited files and branches,
              100 GB of storage, 90-day history, and the in-app agent.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-4 pt-1">
            <div className="grid gap-3 sm:grid-cols-2">
              {plans.map((plan) => (
                <div key={plan.id} className="flex min-w-0 flex-col rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold">{plan.name}</h2>
                      <p className="mt-1 text-xs text-muted-foreground">{plan.summary}</p>
                    </div>
                    {plan.note ? (
                      <span className="shrink-0 whitespace-nowrap rounded-full bg-secondary px-2 py-1 text-xs font-medium">
                        {plan.note}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-xl font-semibold tracking-tight sm:mt-4">
                    {plan.price}<span className="text-xs font-normal text-muted-foreground">/month</span>
                  </p>
                  {plan.id === 'pro' ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      $20/month or $200/year (two months free).
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Does not expire. Upgrade whenever you need more capacity.
                    </p>
                  )}
                  <div className="mt-4 flex flex-1 flex-col justify-end gap-2">
                    {plan.id === 'free' ? (
                      <Button
                        variant="outline"
                        disabled={pending}
                        onClick={() => void startCheckout('free')}
                      >
                        {pending && selectedPlan === 'free'
                          ? 'Opening checkout…'
                          : 'Start free'}
                      </Button>
                    ) : (
                      <>
                        <Button
                          disabled={pending}
                          onClick={() => void startCheckout('pro', 'month')}
                        >
                          {pending && selectedPlan === 'pro'
                            ? 'Opening checkout…'
                            : 'Go Pro — $20/month'}
                        </Button>
                        <Button
                          variant="outline"
                          disabled={pending}
                          onClick={() => void startCheckout('pro', 'year')}
                        >
                          Go Pro — $200/year
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {status?.stale ? (
              <p className="text-xs text-muted-foreground">Billing data may be delayed. Refresh to try again.</p>
            ) : null}
            {error ? <p className="text-sm text-destructive-foreground">{error}</p> : null}
            {error || status?.stale ? (
              <Button variant="outline" disabled={pending} onClick={() => void loadStatus(true)}>
                Retry billing check
              </Button>
            ) : null}
            <Button
              variant="ghost"
              onClick={() => {
                clearWelcomeSeen()
                void authClient.signOut()
              }}
            >
              <LogOutIcon data-slot="icon" />
              Sign out
            </Button>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  )
}
