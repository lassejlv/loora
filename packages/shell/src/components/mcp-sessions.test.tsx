import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, vi, test } from 'vitest'

const sessions = vi.fn()
const revoke = vi.fn()

vi.doMock('@loora/rpc/client', () => ({
  orpc: { mcp: { sessions, revoke } },
}))

const { McpSessions } = await import('./mcp-sessions')

describe('McpSessions', () => {
  beforeEach(() => {
    sessions.mockReset().mockResolvedValue([
      {
        clientId: 'client-1',
        name: 'Codex',
        connectedAt: new Date('2026-07-20T10:00:00Z').getTime(),
        lastAuthorizedAt: new Date('2026-07-21T10:00:00Z').getTime(),
        expiresAt: new Date('2026-07-28T10:00:00Z').getTime(),
      },
    ])
    revoke.mockReset().mockResolvedValue({ revoked: true })
    window.confirm = vi.fn(() => true)
  })

  afterEach(() => cleanup())

  test('lists connected clients and removes one after revocation', async () => {
    render(<McpSessions />)

    expect(await screen.findByText('Codex')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))

    await waitFor(() => expect(revoke).toHaveBeenCalledWith({ clientId: 'client-1' }))
    expect(screen.queryByText('Codex')).toBeNull()
    expect(screen.getByText('No MCP clients are connected.')).toBeTruthy()
  })
})
