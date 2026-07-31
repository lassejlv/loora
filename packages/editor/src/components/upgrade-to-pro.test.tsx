import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const status = mock()
const checkout = mock()

mock.module('@loora/rpc/client', () => ({
  orpc: {
    billing: { status, checkout },
  },
}))

mock.module('@loora/auth/client', () => ({
  authClient: {
    useSession: () => ({
      data: {
        user: {
          id: 'user-1',
          name: 'Test',
          email: 'test@example.com',
          isAdmin: false,
        },
      },
    }),
  },
}))

const { UpgradeToProButton } = await import('./upgrade-to-pro')

const freeBilling = {
  required: true,
  access: true,
  plan: 'free' as const,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  trial: null,
  stale: false,
  source: 'cache' as const,
}

describe('UpgradeToProButton', () => {
  beforeEach(() => {
    status.mockReset().mockResolvedValue(freeBilling)
    checkout.mockReset().mockResolvedValue({ url: 'https://polar.sh/checkout/pro-year' })
  })

  afterEach(() => cleanup())

  test('is hidden for Pro plans', async () => {
    status.mockResolvedValue({ ...freeBilling, plan: 'pro' as const })
    render(<UpgradeToProButton />)
    await waitFor(() => expect(status).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Upgrade to Pro' })).toBeNull()
  })

  test('lets free users pick yearly or monthly Pro checkout', async () => {
    const redirect = mock()
    render(<UpgradeToProButton redirect={redirect} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Pro' }))
    expect(await screen.findByRole('dialog', { name: 'Upgrade to Pro' })).toBeTruthy()
    expect(screen.getByText(/Choose how you want to pay/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Yearly/ }))
    fireEvent.click(screen.getByRole('button', { name: /Continue — \$200\/year/ }))

    await waitFor(() =>
      expect(checkout).toHaveBeenCalledWith({ plan: 'pro', interval: 'year' }),
    )
    expect(redirect).toHaveBeenCalledWith('https://polar.sh/checkout/pro-year')
  })

  test('starts monthly Pro checkout when selected', async () => {
    const redirect = mock()
    checkout.mockResolvedValue({ url: 'https://polar.sh/checkout/pro-month' })
    render(<UpgradeToProButton redirect={redirect} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Pro' }))
    fireEvent.click(screen.getByRole('button', { name: /Monthly/ }))
    fireEvent.click(screen.getByRole('button', { name: /Continue — \$20\/month/ }))

    await waitFor(() =>
      expect(checkout).toHaveBeenCalledWith({ plan: 'pro', interval: 'month' }),
    )
    expect(redirect).toHaveBeenCalledWith('https://polar.sh/checkout/pro-month')
  })
})
