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
  canvasStylePatchSchema,
  createPageInputSchema,
  createPageTransaction,
  insertNodesInputSchema,
  materializeNodeDescriptors,
  normalizeDeletionNodeIds,
  patchOperationsForChanges,
  readCanvasNodeRef,
  semanticTree,
  setTokensInputSchema,
  sourceContainerForRef,
  tokenOperations,
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
    source.themes.focus = { id: 'focus', name: 'Focus' }
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
                { type: 'set-theme', themeId: 'focus' },
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
        actions: [
          { type: 'toggle-state', stateId: 'menuOpen' },
          { type: 'set-theme', themeId: 'focus' },
        ],
      },
    ])
  })

  test('creates named themes before tokens that use their modes', () => {
    const source = createCanvasDocument('Agent theme fixture', 'agent-theme')
    const input = setTokensInputSchema.parse({
      themes: [{ id: 'brand-a', name: 'Brand A' }],
      tokens: [
        {
          id: 'accent',
          name: 'Accent',
          type: 'color',
          value: '#3b82f6',
          modes: { 'brand-a': '#ec4899' },
        },
      ],
    })
    const document = applyTransaction(source, {
      id: 'set-brand-theme',
      label: 'Set brand theme',
      operations: tokenOperations(input.tokens, input.themes),
    }).document

    expect(document.themes['brand-a']?.name).toBe('Brand A')
    expect(document.tokens.accent?.modes?.['brand-a']).toBe('#ec4899')
  })

  test('activates a persisted default theme in the same call', () => {
    const source = createCanvasDocument('Agent theme fixture', 'agent-theme')
    const input = setTokensInputSchema.parse({
      themes: [{ id: 'dark', name: 'Dark' }],
      activeThemeId: 'dark',
    })
    const document = applyTransaction(source, {
      id: 'activate-dark-theme',
      label: 'Activate dark theme',
      operations: tokenOperations(
        input.tokens,
        input.themes,
        input.activeThemeId,
      ),
    }).document

    expect(document.themes.dark?.name).toBe('Dark')
    expect(document.activeThemeId).toBe('dark')
  })

  test('setTokens requires at least one change', () => {
    expect(setTokensInputSchema.safeParse({}).success).toBe(false)
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

describe('MCP input leniency and documentation', () => {
  test('accepts JSON-serialized structured arguments', () => {
    const parsed = insertNodesInputSchema.parse({
      parent: '{"nodeId":"hero","instancePath":["card"]}',
      nodes: '[{"type":"frame","name":"Row","layout":{"mode":"flex","gap":16}}]',
    })

    expect(parsed.parent).toEqual({ nodeId: 'hero', instancePath: ['card'] })
    expect(parsed.nodes[0]?.name).toBe('Row')
  })

  test('accepts JSON-serialized layout, style, and children on createPage', () => {
    const parsed = createPageInputSchema.parse({
      name: 'Home',
      layout: '{"mode":"flex","direction":"column","gap":24}',
      style: '{"opacity":1}',
      children: '[{"type":"text","text":"Hello"}]',
    })

    expect(parsed.layout?.mode).toBe('flex')
    expect(parsed.style?.opacity).toBe(1)
    expect(parsed.children[0]?.type).toBe('text')
  })

  test('rejects plain strings where structures belong', () => {
    expect(() =>
      insertNodesInputSchema.parse({ parent: 'hero', nodes: [] }),
    ).toThrow()
    expect(() =>
      insertNodesInputSchema.parse({
        parent: { nodeId: 'hero' },
        nodes: '[{"nodeId":5}]',
      }),
    ).toThrow()
  })

  test('typography defaults letterSpacing and align', () => {
    const parsed = canvasStylePatchSchema.parse({
      typography: {
        family: 'Inter',
        size: 16,
        weight: 400,
        lineHeight: 1.5,
      },
    })

    expect(parsed.typography).toMatchObject({
      letterSpacing: 0,
      align: 'left',
    })
  })
})
