import { useCallback, useEffect, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { orpc } from '#/lib/orpc-client'
import { MAX_TOP_UP_CENTS, MIN_TOP_UP_CENTS } from '#/lib/top-up-policy'

type BillingStatus = Awaited<ReturnType<typeof orpc.billing.status>>

interface CreditTopUpProps {
  onBillingChange: (billing: BillingStatus) => void
  redirect?: (url: string) => void
}

function centsFromInput(value: string) {
  const dollars = Number(value)
  if (!Number.isFinite(dollars)) return null
  const cents = Math.round(dollars * 100)
  return cents >= MIN_TOP_UP_CENTS && cents <= MAX_TOP_UP_CENTS ? cents : null
}

export function CreditTopUp({ onBillingChange, redirect }: CreditTopUpProps) {
  const [amount, setAmount] = useState('10')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const finishCheckout = useCallback(async (checkoutId: string) => {
    setPending(true)
    setError('')
    try {
      const result = await orpc.billing.completeTopUp({ checkoutId })
      onBillingChange(result.billing)
      if (!result.completed) {
        setMessage('Payment is complete. Credits are still syncing—check again in a moment.')
        return
      }
      setMessage(`Top-up complete. ${result.addedCredits} AI credits were added.`)
      const url = new URL(window.location.href)
      url.searchParams.delete('topup')
      url.searchParams.delete('checkout_id')
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    } catch {
      setError('Could not confirm the top-up yet. Please check again.')
    } finally {
      setPending(false)
    }
  }, [onBillingChange])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const checkoutId = params.get('checkout_id')
    if (params.get('topup') === 'success' && checkoutId) void finishCheckout(checkoutId)
  }, [finishCheckout])

  const amountCents = centsFromInput(amount)
  const previewCredits = amountCents === null ? null : Math.floor(amountCents / 10)
  const checkoutId = new URLSearchParams(window.location.search).get('checkout_id')

  return (
    <div className="rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold">Add prepaid AI credits</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        $1 adds 10 credits. Choose $5–$500. Top-ups never auto-renew.
      </p>
      <div className="mt-4 flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1.5 text-xs font-medium">
          Amount
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">$</span>
            <Input
              aria-label="Top-up amount"
              className="pl-7"
              min={5}
              max={500}
              step={0.01}
              type="number"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
        </label>
        <Button
          disabled={pending || amountCents === null}
          onClick={async () => {
            if (amountCents === null) {
              setError('Choose an amount between $5 and $500.')
              return
            }
            setPending(true)
            setError('')
            setMessage('')
            try {
              const checkout = await orpc.billing.createTopUp({ amountCents })
              const goToCheckout = redirect ?? ((url: string) => window.location.assign(url))
              goToCheckout(checkout.url)
            } catch {
              setError('Could not open top-up checkout. Please retry.')
              setPending(false)
            }
          }}
        >
          {pending ? 'Working…' : `Buy ${previewCredits ?? '—'} credits`}
        </Button>
      </div>
      {message ? <p className="mt-3 text-xs text-cx-accent">{message}</p> : null}
      {error ? <p className="mt-3 text-xs text-destructive-foreground">{error}</p> : null}
      {checkoutId && (message || error) ? (
        <Button
          className="mt-3"
          size="xs"
          variant="outline"
          disabled={pending}
          onClick={() => void finishCheckout(checkoutId)}
        >
          Check top-up status
        </Button>
      ) : null}
    </div>
  )
}
