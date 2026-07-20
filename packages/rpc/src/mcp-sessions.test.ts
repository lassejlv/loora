import { describe, expect, test } from 'bun:test'
import { summarizeMcpSessions } from './mcp-sessions'

describe('summarizeMcpSessions', () => {
  test('collapses rotated tokens into one client session', () => {
    const sessions = summarizeMcpSessions([
      {
        clientId: 'codex',
        clientName: 'Codex',
        createdAt: new Date('2026-07-21T10:00:00Z'),
        updatedAt: new Date('2026-07-21T10:00:00Z'),
        accessTokenExpiresAt: new Date('2026-07-21T11:00:00Z'),
        refreshTokenExpiresAt: new Date('2026-07-28T10:00:00Z'),
      },
      {
        clientId: 'codex',
        clientName: 'Codex',
        createdAt: new Date('2026-07-20T10:00:00Z'),
        updatedAt: new Date('2026-07-20T10:00:00Z'),
        accessTokenExpiresAt: new Date('2026-07-20T11:00:00Z'),
        refreshTokenExpiresAt: new Date('2026-07-27T10:00:00Z'),
      },
    ])

    expect(sessions).toEqual([
      {
        clientId: 'codex',
        name: 'Codex',
        connectedAt: new Date('2026-07-20T10:00:00Z').getTime(),
        lastAuthorizedAt: new Date('2026-07-21T10:00:00Z').getTime(),
        expiresAt: new Date('2026-07-28T10:00:00Z').getTime(),
      },
    ])
  })
})
