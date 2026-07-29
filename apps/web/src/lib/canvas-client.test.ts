import { describe, expect, test } from 'bun:test'
import { createFrameNode, createTextNode } from '@loora/canvas/model'
import { remoteRevealNodeIds } from './canvas-client'

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
