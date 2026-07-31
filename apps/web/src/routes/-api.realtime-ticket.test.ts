import { describe, expect, it } from 'bun:test'
import {
  allowTicketRequest,
  realtimeTicketResponse,
} from './api.realtime-ticket'

describe('Realtime ticket endpoint', () => {
  it('does not mint a ticket without an authenticated session', async () => {
    const response = await realtimeTicketResponse(
      new Request('http://localhost/api/realtime-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          designId: 'private-design',
          sessionId: 'session-1',
        }),
      }),
    )

    expect(response.status).toBe(401)
  })

  it('rejects a body that is not a ticket request', async () => {
    const response = await realtimeTicketResponse(
      new Request('http://localhost/api/realtime-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      }),
    )

    expect(response.status).toBe(400)
  })

  it('turns an account away once it asks for tickets in a loop', () => {
    const user = `user-${Math.random()}`
    const now = 1_700_000_000_000

    const allowed = Array.from({ length: 30 }, () =>
      allowTicketRequest(user, now),
    )
    expect(allowed.every(Boolean)).toBe(true)
    expect(allowTicketRequest(user, now)).toBe(false)
    // The window rolls and the account is served again.
    expect(allowTicketRequest(user, now + 60_000)).toBe(true)
  })
})
