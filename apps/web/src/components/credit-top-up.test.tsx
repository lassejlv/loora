import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const createTopUp = mock()
const completeTopUp = mock()

mock.module('#/lib/orpc-client', () => ({
  orpc: { billing: { createTopUp, completeTopUp } },
}))

const { CreditTopUp } = await import('./credit-top-up')

const billing = {
  required: true,
  access: true,
  plan: 'pro' as const,
  currentPeriodEnd: '2026-08-20T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  credits: {
    remaining: 200,
    credited: 200,
    consumed: 0,
    includedRemaining: 100,
    topUpRemaining: 100,
    topUpPurchased: 100,
    resetsAt: '2026-08-20T00:00:00.000Z',
  },
  stale: false,
  source: 'polar' as const,
}

describe('CreditTopUp', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/')
    createTopUp.mockReset()
    completeTopUp.mockReset()
  })

  afterEach(() => cleanup())

  test('starts a $10 checkout for 100 credits', async () => {
    createTopUp.mockResolvedValue({
      url: 'https://polar.sh/checkout/top-up',
      amountCents: 1_000,
      creditUnits: 100,
    })
    const redirect = mock()

    render(<CreditTopUp onBillingChange={() => undefined} redirect={redirect} />)
    fireEvent.click(screen.getByRole('button', { name: 'Buy 100 credits' }))

    await waitFor(() => expect(createTopUp).toHaveBeenCalledWith({ amountCents: 1_000 }))
    expect(redirect).toHaveBeenCalledWith('https://polar.sh/checkout/top-up')
  })

  test('enforces the $5 minimum before checkout', () => {
    render(<CreditTopUp onBillingChange={() => undefined} />)
    fireEvent.change(screen.getByLabelText('Top-up amount'), { target: { value: '4' } })
    expect((screen.getByRole('button', { name: 'Buy — credits' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('confirms a paid checkout and refreshes the displayed balance', async () => {
    window.history.replaceState({}, '', '/?topup=success&checkout_id=checkout-1')
    completeTopUp.mockResolvedValue({ completed: true, addedCredits: 100, billing })
    const billingChanged = mock()

    render(<CreditTopUp onBillingChange={billingChanged} />)

    expect(await screen.findByText('Top-up complete. 100 AI credits were added.')).toBeTruthy()
    expect(completeTopUp).toHaveBeenCalledWith({ checkoutId: 'checkout-1' })
    expect(billingChanged).toHaveBeenCalledWith(billing)
    await waitFor(() => expect(window.location.search).toBe(''))
  })
})
