import { describe, expect, it } from 'bun:test'
import { createStarterCanvas } from '#/lib/canvas-v2-fixtures'
import { composeCanvasComment } from './comment'

describe('Canvas V2 comments', () => {
  it('addresses an exact NodeRef and local coordinates', () => {
    const document = createStarterCanvas('design', 'Landing')
    const node = Object.values(document.nodes).find(
      (candidate) => candidate.type === 'text',
    )!
    const message = composeCanvasComment(
      document,
      'Make this larger',
      {
        target: { nodeId: node.id, instancePath: [] },
        x: 0.12,
        y: 0.87,
      },
    )
    expect(message).toContain('Make this larger')
    expect(message).toContain(node.id)
    expect(message).toContain('12% from the left')
    expect(message).toContain('87% from the top')
  })
})
