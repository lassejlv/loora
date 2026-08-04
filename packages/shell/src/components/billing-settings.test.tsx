import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, vi, test } from 'vitest'

const status = vi.fn()
const mcpUsage = vi.fn()
const agentUsage = vi.fn()
const portal = vi.fn()

vi.doMock('@loora/rpc/client', () => ({
  orpc: {
    billing: { status, mcpUsage, agentUsage },
  },
}))

vi.doMock('@loora/auth/client', () => ({
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

/** The agent card loads from its own procedure, so it needs its own number. */
const proAgentUsage = {
  metric: 'agent_tool_calls' as const,
  plan: 'pro' as const,
  included: 1_000_000,
  used: 7,
  remaining: 999_993,
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
    agentUsage.mockReset().mockResolvedValue({ usage: proAgentUsage })
    portal.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => cleanup())

  test('shows the current plan and opens the customer portal', async () => {
    render(<BillingSettings />)

    expect(await screen.findByText('Pro')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Manage billing' }))

    await waitFor(() => expect(portal).toHaveBeenCalledTimes(1))
  })

  /** The two cards look alike, so every assertion is scoped to one of them. */
  const usageCard = (title: string) =>
    within(screen.getByText(title).closest('div')!)

  test('shows weekly MCP call usage for the current plan', async () => {
    render(<BillingSettings />)

    expect(await screen.findByText('MCP calls this week')).toBeTruthy()
    const mcp = usageCard('MCP calls this week')
    expect(mcp.getByText('42')).toBeTruthy()
    expect(mcp.getByText(/\/ 1,000,000/)).toBeTruthy()
    expect(mcp.getByText(/999,958 remaining/)).toBeTruthy()
    expect(mcp.getByRole('meter', { name: 'MCP calls used this week' })).toBeTruthy()
  })

  test('counts agent calls on their own card, from their own meter', async () => {
    render(<BillingSettings />)

    expect(await screen.findByText('Agent calls this week')).toBeTruthy()
    const agent = usageCard('Agent calls this week')
    expect(agent.getByText('7')).toBeTruthy()
    expect(agent.getByText(/999,993 remaining/)).toBeTruthy()
    expect(
      agent.getByRole('meter', { name: 'Agent calls used this week' }),
    ).toBeTruthy()
    expect(agentUsage).toHaveBeenCalledTimes(1)
  })

  test('one surface failing leaves the other readable', async () => {
    agentUsage.mockRejectedValue(new Error('agent meter down'))

    render(<BillingSettings />)

    expect(await screen.findByText('agent meter down')).toBeTruthy()
    expect(usageCard('MCP calls this week').getByText('42')).toBeTruthy()
  })

  test('shows when the weekly MCP limit is exhausted', async () => {
    status.mockResolvedValue({ ...proBilling, plan: 'free' as const })
    mcpUsage.mockResolvedValue({ usage: freeUsage })

    render(<BillingSettings />)

    expect(await screen.findByText('Weekly limit reached')).toBeTruthy()
    const mcp = usageCard('MCP calls this week')
    expect(mcp.getByText('200')).toBeTruthy()
    expect(mcp.getByText(/\/ 200/)).toBeTruthy()
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
    expect(screen.getByText(/Free includes 100 calls per week/)).toBeTruthy()
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
    // Two usage cards now, so retry the one that actually failed.
    const failedCard = screen.getByText('down').closest('div')!
    fireEvent.click(
      within(failedCard).getByRole('button', { name: 'Try again' }),
    )

    expect(await screen.findByText(/999,958 remaining/)).toBeTruthy()
    expect(mcpUsage).toHaveBeenCalledTimes(2)
  })
})
