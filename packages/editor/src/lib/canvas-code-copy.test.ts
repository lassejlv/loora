import { describe, expect, it } from 'bun:test'
import {
  createCanvasDocument,
  createFrameNode,
  createPageNode,
} from '@loora/canvas/model'
import { compileCanvasCode } from './canvas-code-copy'

describe('Canvas code copy', () => {
  it('compiles the selected node as HTML, JSX, or Tailwind', () => {
    const document = createCanvasDocument('Copy test', 'copy')
    document.nodes.page = createPageNode('Page', { id: 'page' })
    document.nodes.card = createFrameNode('Card', {
      id: 'card',
      parentId: 'page',
      order: 1_024,
    })
    const ref = { nodeId: 'card', instancePath: [] }

    expect(compileCanvasCode(document, ref, 'html')).toContain('<!doctype html>')
    expect(compileCanvasCode(document, ref, 'jsx')).toContain('style={{')
    expect(compileCanvasCode(document, ref, 'tailwind')).toContain('className=')
  })
})
