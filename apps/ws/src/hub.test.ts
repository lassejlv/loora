import { describe, expect, test } from 'bun:test'
import {
  PRESENCE_TTL_MS,
  type CanvasPresencePeer,
  type CanvasRealtimeEvent,
} from '@loora/realtime/events'
import { MemoryBus } from './bus'
import { RealtimeHub } from './hub'

const CHANNEL = 'loora:canvas:owner-1:design-1:main'

function peer(overrides: Partial<CanvasPresencePeer> = {}): CanvasPresencePeer {
  return {
    sessionId: 'session-1',
    userId: 'user-1',
    name: 'Ada',
    image: null,
    color: '#6c5ce7',
    role: 'owner',
    cursor: { x: 10, y: 20 },
    selection: [],
    updatedAt: Date.now(),
    ...overrides,
  }
}

function harness() {
  const delivered: CanvasRealtimeEvent[] = []
  const bus = new MemoryBus()
  const hub = new RealtimeHub(bus, (_channel, payload) => {
    delivered.push(JSON.parse(payload) as CanvasRealtimeEvent)
  })
  return { bus, hub, delivered }
}

describe('RealtimeHub', () => {
  test('subscribes a room once and drops it when the last socket leaves', async () => {
    const { bus, hub } = harness()

    await hub.join(CHANNEL)
    await hub.join(CHANNEL)
    expect(hub.roomCount).toBe(1)

    await hub.leave(CHANNEL)
    expect(hub.roomCount).toBe(1)
    await hub.publishEvent(CHANNEL, {
      type: 'canvas.changed',
      revision: 2,
      nodeIds: [],
    })

    await hub.leave(CHANNEL)
    expect(hub.roomCount).toBe(0)
    // Nothing is subscribed any more, so a later publish reaches nobody local.
    expect(await bus.publish(CHANNEL, 'ignored')).toBe(true)
  })

  test('stamps and fans out a canvas change', async () => {
    const { hub, delivered } = harness()
    await hub.join(CHANNEL)

    expect(
      await hub.publishEvent(CHANNEL, {
        type: 'canvas.changed',
        revision: 7,
        nodeIds: ['node-1'],
      }),
    ).toBe(true)
    const [event] = delivered
    expect(event?.type).toBe('canvas.changed')
    expect(event).toMatchObject({ revision: 7, nodeIds: ['node-1'] })
    expect(Number.isFinite(event?.sentAt)).toBe(true)
  })

  test('refuses an event that does not match the wire protocol', async () => {
    const { hub, delivered } = harness()
    await hub.join(CHANNEL)

    expect(
      await hub.publishEvent(CHANNEL, {
        type: 'canvas.changed',
        revision: -1,
        nodeIds: [],
      }),
    ).toBe(false)
    expect(delivered).toHaveLength(0)
  })

  test('records presence and tells the room', async () => {
    const { hub, delivered } = harness()
    await hub.join(CHANNEL)

    await hub.publishPresence(CHANNEL, peer())
    expect(delivered[0]).toMatchObject({
      type: 'presence.peer',
      sessionId: 'session-1',
    })
    expect(await hub.readState(CHANNEL)).toMatchObject({
      peers: [expect.objectContaining({ sessionId: 'session-1' })],
      activity: null,
    })

    await hub.clearPresence(CHANNEL, 'session-1')
    expect(delivered[1]).toMatchObject({
      type: 'presence.peer',
      sessionId: 'session-1',
      peer: null,
    })
    expect((await hub.readState(CHANNEL)).peers).toHaveLength(0)
  })

  test('rejects a presence payload that is not a peer', async () => {
    const { hub, delivered } = harness()
    await hub.join(CHANNEL)

    expect(
      await hub.publishPresence(CHANNEL, {
        ...peer(),
        color: 'rebeccapurple',
      }),
    ).toBe(false)
    expect(delivered).toHaveLength(0)
  })

  test('forgets a peer whose tab stopped reporting', async () => {
    const { hub } = harness()
    await hub.join(CHANNEL)

    await hub.publishPresence(
      CHANNEL,
      peer({ updatedAt: Date.now() - PRESENCE_TTL_MS - 1 }),
    )

    expect((await hub.readState(CHANNEL)).peers).toHaveLength(0)
  })

  test('holds agent activity until it expires', async () => {
    const { hub, delivered } = harness()
    await hub.join(CHANNEL)
    const now = Date.now()

    await hub.publishActivity(CHANNEL, {
      id: 'agent_1',
      label: 'Adding elements',
      nodeIds: ['node-1'],
      phase: 'working',
      updatedAt: now,
      expiresAt: now + 30_000,
    })
    expect(delivered[0]).toMatchObject({ type: 'agent.activity' })
    expect((await hub.readState(CHANNEL)).activity).toMatchObject({
      id: 'agent_1',
      phase: 'working',
    })

    await hub.publishActivity(CHANNEL, {
      id: 'agent_1',
      label: 'Adding elements',
      nodeIds: ['node-1'],
      phase: 'settled',
      updatedAt: now - 20_000,
      expiresAt: now - 10_000,
    })
    expect((await hub.readState(CHANNEL)).activity).toBeNull()

    await hub.publishActivity(CHANNEL, null)
    expect((await hub.readState(CHANNEL)).activity).toBeNull()
  })
})
