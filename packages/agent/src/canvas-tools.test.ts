import { describe, expect, test } from 'bun:test'
import { applyTransaction } from '@loora/canvas/engine'
import {
  createCanvasDocument,
  createComponentNode,
  createFrameNode,
  createInstanceNode,
  createPageNode,
  createTextNode,
  defaultLayout,
  type CanvasLayout,
  type CanvasNode,
} from '@loora/canvas/model'
import {
  createPageInputSchema,
  createPageTransaction,
  materializeNodeDescriptors,
  normalizeDeletionNodeIds,
  patchOperationsForChanges,
  readCanvasNodeRef,
  semanticTree,
  sourceContainerForRef,
} from './canvas-tools'

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

describe('Canvas agent NodeRefs', () => {
  test('creates readable Page state and event rules without source code', () => {
    const source = createCanvasDocument('Agent state fixture', 'agent-state')
    const input = createPageInputSchema.parse({
      name: 'Interactive',
      states: {
        menuOpen: {
          id: 'menuOpen',
          name: 'Menu open',
          type: 'boolean',
          initial: false,
        },
      },
      children: [
        {
          ref: 'toggle',
          type: 'frame',
          name: 'Toggle menu',
          semanticTag: 'button',
          interactions: [
            {
              trigger: 'click',
              actions: [
                { type: 'toggle-state', stateId: 'menuOpen' },
              ],
            },
          ],
        },
      ],
    })
    const created = createPageTransaction(source, input)
    const document = applyTransaction(source, created.transaction).document
    const tree = semanticTree(document, created.pageId, 2) as {
      states: Record<string, { initial: boolean }>
      children: Array<{ interactions?: unknown[] }>
    }

    expect(tree.states.menuOpen?.initial).toBe(false)
    expect(tree.children[0]?.interactions).toEqual([
      {
        trigger: 'click',
        actions: [{ type: 'toggle-state', stateId: 'menuOpen' }],
      },
    ])
  })

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

function pageFixture(pageLayout: Partial<CanvasLayout> = {}) {
  const document = createCanvasDocument('Layout fixture', 'layout-fixture')
  const page = createPageNode('Home', {
    id: 'page-home',
    layout: {
      ...defaultLayout(1440, 900),
      mode: 'flex',
      direction: 'column',
      ...pageLayout,
    },
  })
  document.nodes[page.id] = page
  return { document, page }
}

const byName = (nodes: CanvasNode[], name: string) =>
  nodes.find((node) => node.name === name)!

describe('descriptor layout defaults', () => {
  test('nested content flows instead of stacking on the parent origin', () => {
    const { document, page } = pageFixture()
    const { nodes } = materializeNodeDescriptors(document, page.id, [
      {
        type: 'frame',
        name: 'Nav',
        layout: { mode: 'flex', direction: 'row', gap: 28 },
        children: [
          { type: 'text', name: 'Brand', text: 'Mara Chen' },
          { type: 'text', name: 'Work', text: 'Work' },
        ],
      },
    ])

    for (const node of nodes) {
      expect(node.layout.position).toBe('flow')
    }
    // A column parent gives its sections the full inline axis; a row parent
    // lets each child size to its own content.
    expect(byName(nodes, 'Nav').layout.width).toEqual({ unit: 'fill' })
    expect(byName(nodes, 'Brand').layout.width).toEqual({ unit: 'hug' })
    expect(byName(nodes, 'Brand').layout.height).toEqual({ unit: 'hug' })
  })

  test('text never inherits the 320x200 placeholder box', () => {
    const { document, page } = pageFixture()
    const { nodes } = materializeNodeDescriptors(document, page.id, [
      {
        type: 'frame',
        name: 'Button',
        layout: {
          mode: 'flex',
          align: 'center',
          justify: 'center',
          width: { unit: 'px', value: 132 },
          height: { unit: 'px', value: 44 },
        },
        children: [{ type: 'text', name: 'Label', text: 'VIEW WORK' }],
      },
    ])

    expect(byName(nodes, 'Label').layout).toMatchObject({
      position: 'flow',
      width: { unit: 'hug' },
      height: { unit: 'hug' },
    })
  })

  test('coordinates and an explicit position still mean absolute', () => {
    const { document, page } = pageFixture()
    const { nodes } = materializeNodeDescriptors(document, page.id, [
      { type: 'shape', name: 'Badge', layout: { x: 40, y: 24 } },
      { type: 'frame', name: 'Overlay', layout: { position: 'absolute' } },
      { type: 'frame', name: 'Section', layout: { position: 'flow', x: 12 } },
    ])

    expect(byName(nodes, 'Badge').layout).toMatchObject({
      position: 'absolute',
      x: 40,
      y: 24,
      width: { unit: 'px', value: 320 },
    })
    expect(byName(nodes, 'Overlay').layout.position).toBe('absolute')
    expect(byName(nodes, 'Section').layout.position).toBe('flow')
  })

  test('images keep a real box so they do not hug to nothing', () => {
    const { document, page } = pageFixture()
    const { nodes } = materializeNodeDescriptors(document, page.id, [
      { type: 'image', name: 'Shot', src: '/api/asset/one' },
    ])

    expect(byName(nodes, 'Shot').layout).toMatchObject({
      position: 'flow',
      width: { unit: 'px', value: 320 },
      height: { unit: 'px', value: 200 },
    })
  })
})
