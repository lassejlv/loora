import { useCallback, useEffect, useState } from 'react'
import { LogOutIcon } from 'lucide-react'
import { authClient } from '@loora/auth/client'
import { orpc } from '#/lib/orpc-client'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '#/components/ui/dialog'

type Plan = 'pro' | 'studio'
type BillingStatus = Awaited<ReturnType<typeof orpc.billing.status>>

interface SubscriptionScreenProps {
  children: React.ReactNode
  preview: React.ReactNode
}

const plans = [
  { id: 'pro' as const, name: 'Pro', price: '$20', credits: '100 AI credits each month' },
  { id: 'studio' as const, name: 'Studio', price: '$49', credits: '300 AI credits each month', note: '3× AI capacity' },
]

export function SubscriptionScreen({ children, preview }: SubscriptionScreenProps) {
  const [status, setStatus] = useState<BillingStatus | null>(null)
  const [pending, setPending] = useState(true)
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)
  const [error, setError] = useState('')

  const loadStatus = useCallback(async (refresh = false) => {
    setPending(true)
    setError('')
    try {
      const next = refresh ? await orpc.billing.refresh() : await orpc.billing.status()
      setStatus(next)
      return next
    } catch {
      setError('Could not check your subscription. Please try again.')
      return null
    } finally {
      setPending(false)
    }
  }, [])

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

  if (status?.access) return children

  async function startCheckout(plan: Plan) {
    setSelectedPlan(plan)
    setPending(true)
    setError('')
    try {
      await authClient.checkout({ slug: plan })
    } catch {
      setError(`Could not open ${plan === 'pro' ? 'Pro' : 'Studio'} checkout. Please retry.`)
      setPending(false)
    }
  }

  return (
    <>
      <div aria-hidden="true" className="pointer-events-none select-none" inert>
        {preview}
      </div>
      <Dialog open onOpenChange={() => {}}>
        <DialogPopup className="max-w-xl" showCloseButton={false} bottomStickOnMobile={false}>
          <DialogHeader>
            <p className="mb-4 text-lg font-semibold tracking-tight">
              loora<span className="text-cx-accent">.</span>
            </p>
            <DialogTitle>Choose your Loora plan</DialogTitle>
            <DialogDescription>
              Both plans include the full editor, saving, history, exports, and handoffs.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-4 pt-1">
            <div className="grid gap-3 sm:grid-cols-2">
              {plans.map((plan) => (
                <div key={plan.id} className="flex flex-col rounded-lg border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold">{plan.name}</h2>
                      <p className="mt-1 text-xs text-muted-foreground">{plan.credits}</p>
                    </div>
                    {plan.note ? (
                      <span className="rounded-full bg-secondary px-2 py-1 text-[10px] font-medium">
                        {plan.note}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-5 text-2xl font-semibold tracking-tight">
                    {plan.price}<span className="text-xs font-normal text-muted-foreground">/month</span>
                  </p>
                  <Button
                    className="mt-4"
                    variant={plan.id === 'studio' ? 'default' : 'outline'}
                    disabled={pending}
                    onClick={() => void startCheckout(plan.id)}
                  >
                    {pending && selectedPlan === plan.id ? 'Opening checkout…' : `Choose ${plan.name}`}
                  </Button>
                </div>
              ))}
            </div>
            {pending && status === null && selectedPlan === null ? (
              <p className="cx-shimmer text-center text-xs">Checking subscription…</p>
            ) : null}
            {status?.stale ? (
              <p className="text-xs text-muted-foreground">Billing data may be delayed. Refresh to try again.</p>
            ) : null}
            {error ? <p className="text-sm text-destructive-foreground">{error}</p> : null}
            {error || status?.stale ? (
              <Button variant="outline" disabled={pending} onClick={() => void loadStatus(true)}>
                Retry billing check
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => authClient.signOut()}>
              <LogOutIcon data-slot="icon" />
              Sign out
            </Button>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  )
}
