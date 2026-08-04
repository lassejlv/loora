import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, vi, test } from 'vitest'

const status = vi.fn()
const refresh = vi.fn()
const checkout = vi.fn()
const signOut = vi.fn()

vi.doMock('@loora/rpc/client', () => ({
  orpc: { billing: { status, refresh, checkout } },
}))
vi.doMock('@loora/auth/client', () => ({
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
  stale: false,
  source: 'polar' as const,
}

const CACHE_KEY = 'loora:access:billing:user-1'

function renderScreen(redirect?: (url: string) => void) {
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
    checkout.mockReset().mockResolvedValue({ url: 'https://polar.sh/checkout/free' })
    signOut.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => cleanup())

  test('keeps the editor inert and offers Free and Pro', async () => {
    const redirect = vi.fn()
    renderScreen(redirect)

    expect(await screen.findByText('$0')).toBeTruthy()
    expect(await screen.findByText('$20')).toBeTruthy()
    expect(screen.getByText(/100 Agent Calls a week/)).toBeTruthy()
    expect(screen.getByText('No card required')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Go Pro — $20/month' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Go Pro — $200/year' })).toBeTruthy()
    expect(screen.queryByText('Real editor')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Start free' }))
    await waitFor(() => expect(checkout).toHaveBeenCalledWith({ plan: 'free' }))
    expect(redirect).toHaveBeenCalledWith('https://polar.sh/checkout/free')
  })

  test('starts yearly Pro checkout from the plan picker', async () => {
    const redirect = vi.fn()
    checkout.mockResolvedValue({ url: 'https://polar.sh/checkout/pro-year' })
    renderScreen(redirect)

    fireEvent.click(await screen.findByRole('button', { name: 'Go Pro — $200/year' }))
    await waitFor(() =>
      expect(checkout).toHaveBeenCalledWith({ plan: 'pro', interval: 'year' }),
    )
    expect(redirect).toHaveBeenCalledWith('https://polar.sh/checkout/pro-year')
  })

  test('shows the loading shimmer, not the plan picker, while the first check runs', () => {
    status.mockReturnValue(new Promise(() => {}))
    renderScreen()

    expect(screen.getByText('Opening your canvas…')).toBeTruthy()
    expect(screen.queryByText('Choose your Loora plan')).toBeNull()
    expect(screen.queryByText('Real editor')).toBeNull()
  })

  test('mounts the real editor for an active subscription', async () => {
    status.mockResolvedValue({ ...noPlan, access: true, plan: 'free' })
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
    refresh.mockResolvedValue({ ...noPlan, access: true, plan: 'pro' })
    renderScreen()
    expect(await screen.findByText('Real editor')).toBeTruthy()
    expect(refresh).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(window.location.search).toBe(''))
  })
})
