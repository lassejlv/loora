import { describe, expect, test } from 'bun:test'
import {
  createRateLimiter,
  parseClientMessage,
  parseIngestMessage,
  parseStateRequest,
} from './protocol'

const activity = {
  id: 'agent_1',
  label: 'Adding elements',
  nodeIds: ['node-1'],
  phase: 'working' as const,
  updatedAt: 1_700_000_000_000,
  expiresAt: 1_700_000_030_000,
}

const peer = {
  sessionId: 'session-1',
  userId: 'user-1',
  name: 'Ada',
  image: null,
  color: '#6c5ce7',
  role: 'owner' as const,
  cursor: { x: 1, y: 2 },
  selection: [],
  updatedAt: 1_700_000_000_000,
}

describe('client messages', () => {
  test('accepts a heartbeat', () => {
    expect(parseClientMessage('{"type":"ping"}')).toEqual({ type: 'ping' })
  })

  test('rounds a cursor and caps a selection', () => {
    const message = parseClientMessage(
      JSON.stringify({
        type: 'presence',
        cursor: { x: 10.6, y: -4.2 },
        selection: Array.from({ length: 100 }, (_, index) => `node-${index}`),
      }),
    )

    expect(message).toMatchObject({ type: 'presence', cursor: { x: 11, y: -4 } })
    expect(message?.type === 'presence' && message.selection).toHaveLength(64)
  })

  test('drops a cursor that is not a real position', () => {
    expect(
      parseClientMessage(
        JSON.stringify({ type: 'presence', cursor: { x: 'far', y: 0 } }),
      ),
    ).toEqual({ type: 'presence', cursor: null, selection: [] })
    expect(
      parseClientMessage(
        JSON.stringify({ type: 'presence', cursor: { x: 1e9, y: 0 } }),
      ),
    ).toEqual({ type: 'presence', cursor: null, selection: [] })
  })

  test('refuses anything else a socket might send', () => {
    expect(parseClientMessage('not json')).toBeNull()
    expect(parseClientMessage('[]')).toBeNull()
    expect(parseClientMessage(JSON.stringify({ type: 'canvas.changed' }))).toBeNull()
    expect(
      parseClientMessage(JSON.stringify({ type: 'presence', pad: 'x'.repeat(9_000) })),
    ).toBeNull()
  })
})

describe('ingest messages', () => {
  const target = { designId: 'design-1', draftId: null }

  test('accepts each kind a Loora service publishes', () => {
    expect(
      parseIngestMessage({
        kind: 'event',
        ownerUserId: 'owner-1',
        target,
        event: { type: 'canvas.changed', revision: 3, nodeIds: ['node-1'] },
      }),
    ).toMatchObject({ kind: 'event' })
    expect(
      parseIngestMessage({
        kind: 'event',
        ownerUserId: 'owner-1',
        target,
        event: { type: 'branch.changed', draftId: 'dr1', status: 'proposed' },
      }),
    ).toMatchObject({ kind: 'event' })
    expect(
      parseIngestMessage({
        kind: 'activity',
        ownerUserId: 'owner-1',
        target,
        activity,
      }),
    ).toMatchObject({ kind: 'activity' })
    expect(
      parseIngestMessage({
        kind: 'activity',
        ownerUserId: 'owner-1',
        target,
        activity: null,
      }),
    ).toMatchObject({ activity: null })
    expect(
      parseIngestMessage({ kind: 'presence', ownerUserId: 'owner-1', target, peer }),
    ).toMatchObject({ kind: 'presence' })
    expect(
      parseIngestMessage({
        kind: 'presence.clear',
        ownerUserId: 'owner-1',
        target,
        sessionId: 'session-1',
      }),
    ).toMatchObject({ sessionId: 'session-1' })
  })

  test('normalizes a branch target', () => {
    expect(
      parseIngestMessage({
        kind: 'presence.clear',
        ownerUserId: 'owner-1',
        target: { designId: ' design-1 ', draftId: ' branch-1 ' },
        sessionId: 'session-1',
      }),
    ).toMatchObject({ target: { designId: 'design-1', draftId: 'branch-1' } })
  })

  test('refuses a body it cannot trust', () => {
    expect(parseIngestMessage(null)).toBeNull()
    expect(parseIngestMessage({ kind: 'event', target })).toBeNull()
    expect(
      parseIngestMessage({ kind: 'event', ownerUserId: 'owner-1', target: {} }),
    ).toBeNull()
    expect(
      parseIngestMessage({
        kind: 'event',
        ownerUserId: 'owner-1',
        target,
        event: { type: 'presence.state', peers: [] },
      }),
    ).toBeNull()
    expect(
      parseIngestMessage({
        kind: 'presence',
        ownerUserId: 'owner-1',
        target,
        peer: { ...peer, role: 'admin' },
      }),
    ).toBeNull()
    expect(
      parseIngestMessage({
        kind: 'unknown',
        ownerUserId: 'owner-1',
        target,
      }),
    ).toBeNull()
  })
})

describe('state requests', () => {
  test('reads the room being asked about', () => {
    expect(
      parseStateRequest({
        ownerUserId: 'owner-1',
        target: { designId: 'design-1' },
      }),
    ).toEqual({
      ownerUserId: 'owner-1',
      target: { designId: 'design-1', draftId: null },
    })
    expect(parseStateRequest({ target: { designId: 'design-1' } })).toBeNull()
  })
})

describe('rate limiter', () => {
  test('allows a burst and then holds the line until the window rolls', () => {
    const allow = createRateLimiter(3, 1_000)

    expect(allow(1_000)).toBe(true)
    expect(allow(1_100)).toBe(true)
    expect(allow(1_200)).toBe(true)
    expect(allow(1_300)).toBe(false)
    expect(allow(2_100)).toBe(true)
  })
})
