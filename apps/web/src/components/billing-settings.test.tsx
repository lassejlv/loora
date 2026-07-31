import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const status = mock()
const mcpUsage = mock()
const portal = mock()

mock.module('@loora/rpc/client', () => ({
  orpc: {
    billing: { status, mcpUsage },
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

const proUsage = {
  metric: 'mcp_tool_calls' as const,
  plan: 'pro' as const,
  included: 1_000_000,
  used: 42,
  remaining: 999_958,
  periodStart: '2026-07-27T00:00:00.000Z',
  resetsAt: '2026-08-03T00:00:00.000Z',
}

const freeUsage = {
  metric: 'mcp_tool_calls' as const,
  plan: 'free' as const,
  included: 200,
  used: 200,
  remaining: 0,
  periodStart: '2026-07-27T00:00:00.000Z',
  resetsAt: '2026-08-03T00:00:00.000Z',
}

describe('BillingSettings', () => {
  beforeEach(() => {
    status.mockReset().mockResolvedValue(proBilling)
    mcpUsage.mockReset().mockResolvedValue({ usage: proUsage })
    portal.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => cleanup())

  test('shows the current plan and opens the customer portal', async () => {
    render(<BillingSettings />)

    expect(await screen.findByText('Pro')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Manage billing' }))

    await waitFor(() => expect(portal).toHaveBeenCalledTimes(1))
  })

  test('shows weekly MCP call usage for the current plan', async () => {
    render(<BillingSettings />)

    expect(await screen.findByText('MCP calls this week')).toBeTruthy()
    expect(screen.getByText('42')).toBeTruthy()
    expect(screen.getByText(/\/ 1,000,000/)).toBeTruthy()
    expect(screen.getByText(/999,958 remaining/)).toBeTruthy()
    expect(screen.getByRole('meter', { name: 'MCP calls used this week' })).toBeTruthy()
  })

  test('shows when the weekly MCP limit is exhausted', async () => {
    status.mockResolvedValue({ ...proBilling, plan: 'free' as const })
    mcpUsage.mockResolvedValue({ usage: freeUsage })

    render(<BillingSettings />)

    expect(await screen.findByText('Weekly limit reached')).toBeTruthy()
    expect(screen.getByText('200')).toBeTruthy()
    expect(screen.getByText(/\/ 200/)).toBeTruthy()
  })

  test('shows the no-plan MCP card when usage is null', async () => {
    status.mockResolvedValue({
      ...proBilling,
      access: false,
      plan: null,
    })
    mcpUsage.mockResolvedValue({ usage: null })

    render(<BillingSettings />)

    expect(await screen.findAllByText('No plan')).toHaveLength(2)
    expect(screen.getByText(/Free includes 200 calls per week/)).toBeTruthy()
    expect(screen.getByText(/Pro and Studio include 1,000,000/)).toBeTruthy()
  })

  test('explains when billing is disabled for the environment', async () => {
    status.mockResolvedValue({
      ...proBilling,
      required: false,
      plan: null,
      source: 'disabled' as const,
    })
    mcpUsage.mockResolvedValue({
      usage: {
        ...proUsage,
        plan: 'disabled',
        included: null,
        used: 0,
        remaining: null,
      },
    })

    render(<BillingSettings />)

    expect(await screen.findByText('Billing is disabled')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Manage billing' })).toBeNull()
    expect(await screen.findByText('Unlimited')).toBeTruthy()
  })

  test('surfaces MCP usage load failures without blocking plan info', async () => {
    mcpUsage.mockRejectedValue(new Error('MCP usage is temporarily unavailable.'))

    render(<BillingSettings />)

    expect(await screen.findByText('Pro')).toBeTruthy()
    expect(
      await screen.findByText('MCP usage is temporarily unavailable.'),
    ).toBeTruthy()
  })

  test('retries MCP usage after a load failure', async () => {
    mcpUsage
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ usage: proUsage })

    render(<BillingSettings />)

    expect(await screen.findByText('down')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText(/999,958 remaining/)).toBeTruthy()
    expect(mcpUsage).toHaveBeenCalledTimes(2)
  })
})
