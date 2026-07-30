import { describe, expect, test } from 'bun:test'
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
