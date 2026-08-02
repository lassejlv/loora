import { describe, expect, test } from 'vitest'
import type { CanvasTransaction } from '@loora/canvas/engine'
import {
  createCanvasDocument,
  createFrameNode,
  createPageNode,
  createTextNode,
} from '@loora/canvas/model'
import {
  applyAcknowledgedTransactions,
  parseCanvasRealtimeMessage,
  remoteRevealNodeIds,
} from './canvas-client'

describe('remoteRevealNodeIds', () => {
  test('reveals inserted groups once and keeps separately edited details', () => {
    expect(
      remoteRevealNodeIds([
        {
          id: 'tx-remote',
          label: 'MCP inserted details',
          operations: [
            {
              type: 'node.insert',
              node: createFrameNode('Section', {
                id: 'section',
                parentId: 'page',
              }),
            },
            {
              type: 'node.insert',
              node: createTextNode('Title', {
                id: 'title',
                parentId: 'section',
              }),
            },
            {
              type: 'node.insert',
              node: createTextNode('Caption', {
                id: 'caption',
                parentId: 'page',
              }),
            },
            {
              type: 'node.patch',
              id: 'existing-card',
              patch: { name: 'Updated card' },
            },
            {
              type: 'node.delete',
              id: 'removed-card',
            },
          ],
        },
      ]),
    ).toEqual(['section', 'caption', 'existing-card'])
  })

  test('deduplicates large repeated edit batches without changing order', () => {
    const operations = Array.from({ length: 2_000 }, (_, index) => ({
      type: 'node.patch' as const,
      id: index % 2 === 0 ? 'hero' : 'caption',
      patch: { hidden: index % 4 === 0 },
    }))

    expect(
      remoteRevealNodeIds([
        { id: 'tx-repeated', label: 'Repeated edits', operations },
      ]),
    ).toEqual(['hero', 'caption'])
  })
})

describe('applyAcknowledgedTransactions', () => {
  test('advances the confirmed base without applying transactions still pending', () => {
    const base = createCanvasDocument('Fixture', 'fixture')
    base.nodes.page = createPageNode('Home', { id: 'page' })
    base.nodes.title = createTextNode('Title', {
      id: 'title',
      parentId: 'page',
    })
    const first: CanvasTransaction = {
      id: 'tx-first',
      label: 'First',
      operations: [
        {
          type: 'node.patch',
          id: 'title',
          patch: { name: 'Confirmed title' },
        },
      ],
    }
    const second: CanvasTransaction = {
      id: 'tx-second',
      label: 'Second',
      operations: [
        {
          type: 'node.patch',
          id: 'title',
          patch: { hidden: true },
        },
      ],
    }

    const confirmed = applyAcknowledgedTransactions(
      base,
      [first, second],
      [first.id],
    )

    expect(confirmed.nodes.title.name).toBe('Confirmed title')
    expect(confirmed.nodes.title.hidden).toBe(false)
    expect(base.nodes.title.name).toBe('Title')
  })
})

describe('Canvas realtime messages', () => {
  test('accepts revision invalidations and expiring agent activity', () => {
    expect(
      parseCanvasRealtimeMessage(
        JSON.stringify({
          type: 'canvas.changed',
          revision: 7,
          nodeIds: ['hero'],
          sentAt: 100,
        }),
      ),
    ).toMatchObject({ type: 'canvas.changed', revision: 7 })
    expect(
      parseCanvasRealtimeMessage(
        JSON.stringify({
          type: 'agent.activity',
          activity: {
            id: 'activity-1',
            label: 'Agent is working',
            nodeIds: ['hero'],
            phase: 'working',
            updatedAt: 100,
            expiresAt: 1_000,
          },
          sentAt: 100,
        }),
      ),
    ).toMatchObject({
      type: 'agent.activity',
      activity: { id: 'activity-1' },
    })
  })

  test('accepts the socket service opening frame', () => {
    const peer = {
      sessionId: 'session-2',
      userId: 'user-2',
      name: 'Ada',
      image: null,
      color: '#6c5ce7',
      role: 'edit',
      cursor: { x: 4, y: 8 },
      selection: ['hero'],
      updatedAt: 100,
    }

    expect(
      parseCanvasRealtimeMessage(
        JSON.stringify({
          type: 'ready',
          sessionId: 'session-1',
          role: 'owner',
          peers: [peer],
          activity: null,
          sentAt: 100,
        }),
      ),
    ).toMatchObject({ type: 'ready', peers: [{ sessionId: 'session-2' }] })
    expect(
      parseCanvasRealtimeMessage(JSON.stringify({ type: 'pong', sentAt: 100 })),
    ).toMatchObject({ type: 'pong' })
    // A room the socket service could not describe is not a room to trust.
    expect(
      parseCanvasRealtimeMessage(
        JSON.stringify({
          type: 'ready',
          sessionId: 'session-1',
          role: 'admin',
          peers: [],
          activity: null,
          sentAt: 100,
        }),
      ),
    ).toBeNull()
  })

  test('drops malformed events', () => {
    expect(parseCanvasRealtimeMessage('{nope')).toBeNull()
    expect(
      parseCanvasRealtimeMessage(
        JSON.stringify({
          type: 'canvas.changed',
          revision: -1,
          nodeIds: [],
          sentAt: 100,
        }),
      ),
    ).toBeNull()
  })
})
