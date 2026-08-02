import { describe, expect, it } from 'vitest'
import { canvasEventsResponse } from './api.canvas-events'

describe('Canvas realtime endpoint', () => {
  it('does not expose a target stream without an authenticated session', async () => {
    const response = await canvasEventsResponse(
      new Request(
        'http://localhost/api/canvas-events?designId=private-design',
      ),
    )

    expect(response.status).toBe(401)
  })
})
