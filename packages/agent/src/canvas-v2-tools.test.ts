import { describe, expect, test } from 'bun:test'
import {
  createCanvasDocument,
  createComponentNode,
  createFrameNode,
  createInstanceNode,
  createPageNode,
  createTextNode,
} from '@loora/canvas/model'
import {
  normalizeDeletionNodeIds,
  patchOperationsForChanges,
  readCanvasNodeRef,
  semanticTree,
  sourceContainerForRef,
} from './canvas-v2-tools'

function componentFixture() {
  const document = createCanvasDocument('Agent fixture', 'fixture')
  const page = createPageNode('Home', { id: 'page-home' })
  const frame = createFrameNode('Hero', {
    id: 'hero',
    parentId: page.id,
  })
  const child = createFrameNode('Hero content', {
    id: 'hero-content',
    parentId: frame.id,
  })
  const component = createComponentNode('Card', { id: 'card' })
  const label = createTextNode('Default label', {
    id: 'card-label',
    parentId: component.id,
  })
  const instance = createInstanceNode(component.id, 'Card instance', {
    id: 'card-instance',
    parentId: frame.id,
    overrides: {
      [label.id]: {
        text: 'Instance label',
      },
    },
  })
  document.nodes = Object.fromEntries(
    [page, frame, child, component, label, instance].map((node) => [
      node.id,
      node,
    ]),
  )
  return { document, page, frame, child, component, label, instance }
}

describe('Canvas V2 agent NodeRefs', () => {
  test('reads source and effective instance state', () => {
    const { document, label, instance } = componentFixture()
    const result = readCanvasNodeRef(document, {
      nodeId: label.id,
      instancePath: [instance.id],
    })

    expect(result.source).toEqual(label)
    expect(result.effective.type).toBe('text')
    expect(
      result.effective.type === 'text' ? result.effective.text : null,
    ).toBe('Instance label')
    expect(result.override).toEqual({ text: 'Instance label' })
  })

  test('rejects a NodeRef whose source is outside the instance component', () => {
    const { document, page, instance } = componentFixture()
    expect(() =>
      readCanvasNodeRef(document, {
        nodeId: page.id,
        instancePath: [instance.id],
      }),
    ).toThrow('not inside the addressed component instance')
  })

  test('semantic trees return usable refs for instance descendants', () => {
    const { document, instance, label } = componentFixture()
    const tree = semanticTree(document, instance.id, 4) as {
      ref: { nodeId: string; instancePath: string[] }
      children: Array<{
        ref: { nodeId: string; instancePath: string[] }
        text?: string
      }>
    }

    expect(tree.ref).toEqual({
      nodeId: instance.id,
      instancePath: [],
    })
    expect(tree.children[0]?.ref).toEqual({
      nodeId: label.id,
      instancePath: [instance.id],
    })
    expect(tree.children[0]?.text).toBe('Instance label')
  })

  test('keeps structural insertion out of instance overrides', () => {
    const { document, label, instance } = componentFixture()
    expect(() =>
      sourceContainerForRef(document, {
        nodeId: label.id,
        instancePath: [instance.id],
      }),
    ).toThrow('Structural insertion inside an instance is not supported')
  })

  test('builds visual instance patches and rejects structural overrides', () => {
    const { document, label, instance } = componentFixture()
    const ref = {
      nodeId: label.id,
      instancePath: [instance.id],
    }
    expect(
      patchOperationsForChanges(document, [
        { ref, patch: { text: 'Updated label' } },
      ]),
    ).toEqual([
      {
        type: 'instance.patchOverride',
        id: instance.id,
        targetId: label.id,
        patch: { text: 'Updated label' },
      },
    ])
    expect(() =>
      patchOperationsForChanges(document, [
        { ref, patch: { order: 2048 } },
      ]),
    ).toThrow('visual/content fields only')
  })

  test('collapses descendant deletes into their requested ancestor', () => {
    const { document, frame, child } = componentFixture()
    expect(
      normalizeDeletionNodeIds(document, [child.id, frame.id, child.id]),
    ).toEqual([frame.id])
  })
})
