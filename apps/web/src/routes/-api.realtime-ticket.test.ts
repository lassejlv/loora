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

  it('turns an account away once it asks for tickets in a loop', async () => {
    const user = `user-${Math.random()}`

    for (let attempt = 0; attempt < 30; attempt += 1) {
      expect((await allowTicketRequest(user)).ok).toBe(true)
    }
    const refused = await allowTicketRequest(user)
    expect(refused.ok).toBe(false)
    expect(refused.retryAfterSeconds).toBe(60)
  })
})
