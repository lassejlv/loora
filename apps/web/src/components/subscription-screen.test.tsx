import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const status = mock()
const refresh = mock()
const checkout = mock()
const signOut = mock()

mock.module('#/lib/orpc-client', () => ({
  orpc: { billing: { status, refresh, checkout } },
}))
mock.module('@loora/auth/client', () => ({
  authClient: { signOut },
}))

const { SubscriptionScreen } = await import('./subscription-screen')

const noPlan = {
  required: true,
  access: false,
  plan: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  trial: null,
  credits: null,
  stale: false,
  source: 'polar' as const,
}

const CACHE_KEY = 'loora:access:billing:user-1'

function renderScreen(redirect?: ReturnType<typeof mock>) {
  return render(
    <SubscriptionScreen userId="user-1" preview={<div>Preview canvas</div>} redirect={redirect}>
      <div>Real editor</div>
    </SubscriptionScreen>,
  )
}

describe('SubscriptionScreen', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/')
    window.localStorage.clear()
    status.mockReset().mockResolvedValue(noPlan)
    refresh.mockReset().mockResolvedValue(noPlan)
    checkout.mockReset().mockResolvedValue({ url: 'https://polar.sh/checkout/pro-trial' })
    signOut.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => cleanup())

  test('keeps the editor inert and offers both plan checkouts', async () => {
    const redirect = mock()
    renderScreen(redirect)

    expect(await screen.findByText('$20')).toBeTruthy()
    expect(screen.getByText('$49')).toBeTruthy()
    expect(screen.getByText('3-day free trial')).toBeTruthy()
    expect(screen.queryByText('Real editor')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Start free trial' }))
    await waitFor(() => expect(checkout).toHaveBeenCalledWith({ plan: 'pro' }))
    expect(redirect).toHaveBeenCalledWith('https://polar.sh/checkout/pro-trial')
  })

  test('shows the loading shimmer, not the plan picker, while the first check runs', () => {
    status.mockReturnValue(new Promise(() => {}))
    renderScreen()

    expect(screen.getByText('Opening your canvas…')).toBeTruthy()
    expect(screen.queryByText('Choose your Loora plan')).toBeNull()
    expect(screen.queryByText('Real editor')).toBeNull()
  })

  test('mounts the real editor for an active subscription', async () => {
    status.mockResolvedValue({ ...noPlan, access: true, plan: 'pro' })
    renderScreen()
    expect(await screen.findByText('Real editor')).toBeTruthy()
    expect(screen.queryByText('Choose your Loora plan')).toBeNull()
    expect(window.localStorage.getItem(CACHE_KEY)).toBe('1')
  })

  test('mounts the editor immediately from a cached verdict while the check re-runs', () => {
    window.localStorage.setItem(CACHE_KEY, '1')
    status.mockReturnValue(new Promise(() => {}))
    renderScreen()

    expect(screen.getByText('Real editor')).toBeTruthy()
  })

  test('drops the cached verdict when the subscription has lapsed', async () => {
    window.localStorage.setItem(CACHE_KEY, '1')
    renderScreen()

    expect(screen.getByText('Real editor')).toBeTruthy()
    expect(await screen.findByText('Choose your Loora plan')).toBeTruthy()
    expect(window.localStorage.getItem(CACHE_KEY)).toBeNull()
  })

  test('refreshes after checkout and clears checkout query parameters', async () => {
    window.history.replaceState({}, '', '/?checkout=success&checkout_id=checkout-1')
    refresh.mockResolvedValue({ ...noPlan, access: true, plan: 'studio' })
    renderScreen()
    expect(await screen.findByText('Real editor')).toBeTruthy()
    expect(refresh).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(window.location.search).toBe(''))
  })
})
