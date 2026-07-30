import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const status = mock()
const portal = mock()

mock.module('#/lib/orpc-client', () => ({
  orpc: {
    billing: { status },
  },
}))

mock.module('@loora/auth/client', () => ({
  authClient: {
    useSession: () => ({
      data: {
        user: {
          id: 'user-1',
          name: 'Test User',
          email: 'test@example.com',
          isAdmin: false,
        },
      },
    }),
    customer: { portal },
  },
}))

const { BillingSettings } = await import('./billing-settings')

const proBilling = {
  required: true,
  access: true,
  plan: 'pro' as const,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  trial: null,
  stale: false,
  source: 'cache' as const,
}

describe('BillingSettings', () => {
  beforeEach(() => {
    status.mockReset().mockResolvedValue(proBilling)
    portal.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => cleanup())

  test('shows the current plan and opens the customer portal', async () => {
    render(<BillingSettings />)

    expect(await screen.findByText('Pro')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Manage billing' }))

    await waitFor(() => expect(portal).toHaveBeenCalledTimes(1))
  })

  test('explains when billing is disabled for the environment', async () => {
    status.mockResolvedValue({
      ...proBilling,
      required: false,
      plan: null,
      source: 'disabled' as const,
    })

    render(<BillingSettings />)

    expect(await screen.findByText('Billing is disabled')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Manage billing' })).toBeNull()
  })
})
