import { describe, expect, it } from 'bun:test'
import { realtimeTicketResponse } from './api.realtime-ticket'

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

  it('rejects a request without a session id to key presence by', async () => {
    const response = await realtimeTicketResponse(
      new Request('http://localhost/api/realtime-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ designId: 'private-design' }),
      }),
    )

    expect(response.status).toBe(400)
  })
})
