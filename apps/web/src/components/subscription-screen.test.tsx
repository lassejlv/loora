import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const status = mock()
const refresh = mock()
const checkout = mock()
const signOut = mock()

mock.module('#/lib/orpc-client', () => ({
  orpc: { billing: { status, refresh } },
}))
mock.module('@loora/auth/client', () => ({
  authClient: { checkout, signOut },
}))

const { SubscriptionScreen } = await import('./subscription-screen')

const noPlan = {
  required: true,
  access: false,
  plan: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  credits: null,
  stale: false,
  source: 'polar' as const,
}

describe('SubscriptionScreen', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/')
    status.mockReset().mockResolvedValue(noPlan)
    refresh.mockReset().mockResolvedValue(noPlan)
    checkout.mockReset().mockResolvedValue(undefined)
    signOut.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => cleanup())

  test('keeps the editor inert and offers both plan checkouts', async () => {
    render(
      <SubscriptionScreen preview={<div>Preview canvas</div>}>
        <div>Real editor</div>
      </SubscriptionScreen>,
    )

    expect(await screen.findByText('$20')).toBeTruthy()
    expect(screen.getByText('$49')).toBeTruthy()
    expect(screen.queryByText('Real editor')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Choose Pro' }))
    await waitFor(() => expect(checkout).toHaveBeenCalledWith({ slug: 'pro' }))
  })

  test('mounts the real editor for an active subscription', async () => {
    status.mockResolvedValue({ ...noPlan, access: true, plan: 'pro' })
    render(
      <SubscriptionScreen preview={<div>Preview canvas</div>}>
        <div>Real editor</div>
      </SubscriptionScreen>,
    )
    expect(await screen.findByText('Real editor')).toBeTruthy()
    expect(screen.queryByText('Choose your Loora plan')).toBeNull()
  })

  test('refreshes after checkout and clears checkout query parameters', async () => {
    window.history.replaceState({}, '', '/?checkout=success&checkout_id=checkout-1')
    refresh.mockResolvedValue({ ...noPlan, access: true, plan: 'studio' })
    render(
      <SubscriptionScreen preview={<div>Preview canvas</div>}>
        <div>Real editor</div>
      </SubscriptionScreen>,
    )
    expect(await screen.findByText('Real editor')).toBeTruthy()
    expect(refresh).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(window.location.search).toBe(''))
  })
})
