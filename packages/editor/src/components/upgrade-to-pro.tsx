import { useEffect, useState } from 'react'
import { authClient } from '@loora/auth/client'
import { Button } from '@loora/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@loora/ui/dialog'
import { orpc } from '@loora/rpc/client'
import { cn } from '@loora/ui/utils'

type BillingStatus = Awaited<ReturnType<typeof orpc.billing.status>>
type ProInterval = 'month' | 'year'

const OPTIONS: {
  id: ProInterval
  label: string
  price: string
  detail: string
  badge?: string
}[] = [
  {
    id: 'month',
    label: 'Monthly',
    price: '$20',
    detail: 'Billed every month. Cancel anytime.',
  },
  {
    id: 'year',
    label: 'Yearly',
    price: '$200',
    detail: 'Two months free compared with monthly.',
    badge: 'Save $40',
  },
]

function shouldOfferUpgrade(status: BillingStatus | null, isAdmin: boolean) {
  if (isAdmin) return false
  if (!status?.required) return false
  if (status.trial) return false
  return status.plan === 'free'
}

/**
 * Compact CTA for Free accounts. Opens a monthly/yearly picker, then Polar
 * checkout for the chosen Pro product.
 */
export function UpgradeToProButton({
  className,
  size = 'sm',
  variant = 'default',
  fullWidth = false,
  redirect,
}: {
  className?: string
  size?: 'xs' | 'sm' | 'default'
  variant?: 'default' | 'outline' | 'secondary'
  fullWidth?: boolean
  /** Test seam — production uses `window.location.assign`. */
  redirect?: (url: string) => void
}) {
  const { data: session } = authClient.useSession()
  const [status, setStatus] = useState<BillingStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [interval, setInterval] = useState<ProInterval>('year')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void orpc.billing
      .status()
      .then((next) => {
        if (!cancelled) setStatus(next)
      })
      .catch(() => {
        if (!cancelled) setStatus(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!shouldOfferUpgrade(status, session?.user?.isAdmin === true)) {
    return null
  }

  const startCheckout = async (chosen: ProInterval) => {
    setPending(true)
    setError('')
    try {
      const checkout = await orpc.billing.checkout({
        plan: 'pro',
        interval: chosen,
      })
      const go = redirect ?? ((url: string) => window.location.assign(url))
      go(checkout.url)
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message.trim()
          ? cause.message
          : 'Could not open Pro checkout. Please try again.',
      )
      setPending(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        className={cn(fullWidth && 'w-full', className)}
        onClick={() => {
          setError('')
          setOpen(true)
        }}
      >
        Upgrade to Pro
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upgrade to Pro</DialogTitle>
            <DialogDescription>
              Unlimited files and branches, 100 GB storage, 90-day history, and the
              in-app agent. Choose how you want to pay.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-2">
            {OPTIONS.map((option) => {
              const selected = interval === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={pending}
                  aria-pressed={selected}
                  onClick={() => setInterval(option.id)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-md border px-3 py-3 text-start transition-colors',
                    selected
                      ? 'border-foreground/25 bg-secondary'
                      : 'border-line hover:bg-secondary/50',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border',
                      selected
                        ? 'border-foreground bg-foreground'
                        : 'border-muted-foreground/40',
                    )}
                    aria-hidden
                  >
                    {selected ? (
                      <span className="size-1.5 rounded-full bg-background" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{option.label}</span>
                      {option.badge ? (
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-2xs font-medium text-foreground">
                          {option.badge}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {option.detail}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {option.price}
                    <span className="text-xs font-normal text-muted-foreground">
                      {option.id === 'year' ? '/year' : '/mo'}
                    </span>
                  </span>
                </button>
              )
            })}
            {error ? (
              <p className="text-xs text-destructive-foreground">{error}</p>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Not now
            </Button>
            <Button
              disabled={pending}
              onClick={() => void startCheckout(interval)}
            >
              {pending
                ? 'Opening checkout…'
                : interval === 'year'
                  ? 'Continue — $200/year'
                  : 'Continue — $20/month'}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  )
}
