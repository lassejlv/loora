import { describe, expect, it } from 'bun:test'
import {
  canvasRealtimeChannel,
  parseCanvasRealtimeEvent,
} from './canvas-realtime'

describe('Canvas realtime events', () => {
  it('isolates channels by user, design, and branch target', () => {
    expect(
      canvasRealtimeChannel('user:one', {
        designId: 'design/one',
        draftId: 'branch one',
      }),
    ).toBe(
      'loora:canvas:user%3Aone:design%2Fone:draft%3Abranch%20one',
    )
    expect(
      canvasRealtimeChannel('user:one', {
        designId: 'design/one',
      }),
    ).toEndWith(':main')
  })

  it('accepts bounded change and activity payloads', () => {
    expect(
      parseCanvasRealtimeEvent(
        JSON.stringify({
          type: 'canvas.changed',
          revision: 4,
          nodeIds: ['hero'],
          sentAt: 10,
        }),
      ),
    ).toMatchObject({ type: 'canvas.changed', revision: 4 })
    expect(
      parseCanvasRealtimeEvent(
        JSON.stringify({
          type: 'agent.activity',
          activity: {
            id: 'activity-1',
            label: 'Agent is working',
            nodeIds: ['hero'],
            phase: 'working',
            updatedAt: 10,
            expiresAt: 20,
          },
          sentAt: 10,
        }),
      ),
    ).toMatchObject({
      type: 'agent.activity',
      activity: { id: 'activity-1' },
    })
  })

  it('rejects malformed or oversized payloads', () => {
    expect(parseCanvasRealtimeEvent('{nope')).toBeNull()
    expect(
      parseCanvasRealtimeEvent(
        JSON.stringify({
          type: 'canvas.changed',
          revision: -1,
          nodeIds: [],
          sentAt: 10,
        }),
      ),
    ).toBeNull()
    expect(parseCanvasRealtimeEvent('x'.repeat(100_001))).toBeNull()
  })
})
