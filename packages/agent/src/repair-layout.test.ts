import { describe, expect, test } from 'bun:test'
import {
  createCanvasDocument,
  createFrameNode,
  createPageNode,
  createTextNode,
  defaultLayout,
  defaultStyle,
  type CanvasDocument,
  type CanvasLayout,
  type CanvasNode,
  type ShapeNode,
} from '@loora/canvas/model'
import { repairStackedLayout } from './repair-layout'

function documentWith(nodes: CanvasNode[]): CanvasDocument {
  const document = createCanvasDocument('Repair fixture', 'repair-fixture')
  for (const node of nodes) document.nodes[node.id] = node
  return document
}

function shapeNode(id: string, parentId: string, layout: CanvasLayout): ShapeNode {
  return {
    id,
    type: 'shape',
    shape: 'rectangle',
    name: id,
    parentId,
    order: 1024,
    hidden: false,
    locked: false,
    rotation: 0,
    layout,
    style: defaultStyle(),
    responsive: {},
    interactions: [],
  }
}

function brokenPage() {
  const page = createPageNode('Home', {
    id: 'page',
    layout: { ...defaultLayout(1440, 900), mode: 'flex', direction: 'column' },
  })
  const hero = createFrameNode('Hero', {
    id: 'hero',
    parentId: page.id,
    layout: { ...defaultLayout(), position: 'absolute', x: 0, y: 0, mode: 'flex', direction: 'column' },
  })
  const headline = createTextNode('I make digital products', {
    id: 'headline',
    parentId: hero.id,
    layout: { ...defaultLayout(), position: 'absolute', x: 0, y: 0 },
  })
  return { page, hero, headline }
}

describe('repairStackedLayout', () => {
  test('flows children that an arranging parent had stacked on its origin', () => {
    const { page, hero, headline } = brokenPage()
    const repair = repairStackedLayout(documentWith([page, hero, headline]))

    expect(repair.flowed.sort()).toEqual(['headline', 'hero'])
    expect(repair.document.nodes.hero!.layout.position).toBe('flow')
    expect(repair.document.nodes.headline!.layout.position).toBe('flow')
  })

  test('drops the 320x200 placeholder box off repaired text', () => {
    const { page, hero, headline } = brokenPage()
    const repair = repairStackedLayout(documentWith([page, hero, headline]))

    expect(repair.unboxed).toEqual(['headline'])
    expect(repair.document.nodes.headline!.layout).toMatchObject({
      width: { unit: 'hug' },
      height: { unit: 'hug' },
    })
    // A frame keeps whatever box it was given; only its placement changes.
    expect(repair.document.nodes.hero!.layout.width).toEqual({ unit: 'px', value: 320 })
  })

  test('keeps deliberate overlays that carry real coordinates', () => {
    const page = createPageNode('Home', {
      id: 'page',
      layout: { ...defaultLayout(1440, 900), mode: 'flex', direction: 'column' },
    })
    const badge = shapeNode('badge', page.id, { ...defaultLayout(), position: 'absolute', x: 24, y: 40 })
    const repair = repairStackedLayout(documentWith([page, badge]))

    expect(repair.flowed).toEqual([])
    expect(repair.document.nodes.badge!.layout).toMatchObject({ position: 'absolute', x: 24, y: 40 })
  })

  test('leaves a lone absolute child of a plain frame alone', () => {
    const page = createPageNode('Home', { id: 'page' })
    const frame = createFrameNode('Art', {
      id: 'art',
      parentId: page.id,
      layout: { ...defaultLayout(), position: 'flow' },
    })
    const fill = shapeNode('fill', frame.id, { ...defaultLayout(), position: 'absolute', x: 0, y: 0 })
    const repair = repairStackedLayout(documentWith([page, frame, fill]))

    expect(repair.flowed).toEqual([])
  })

  test('still unstacks a pile inside a plain frame', () => {
    const page = createPageNode('Home', { id: 'page' })
    const frame = createFrameNode('Art', {
      id: 'art',
      parentId: page.id,
      layout: { ...defaultLayout(), position: 'flow' },
    })
    const stacked = ['one', 'two'].map((id) =>
      shapeNode(id, frame.id, { ...defaultLayout(), position: 'absolute', x: 0, y: 0 }),
    )
    const repair = repairStackedLayout(documentWith([page, frame, ...stacked]))

    expect(repair.flowed.sort()).toEqual(['one', 'two'])
  })

  test('is a no-op on a healthy document', () => {
    const page = createPageNode('Home', {
      id: 'page',
      layout: { ...defaultLayout(1440, 900), mode: 'flex', direction: 'column' },
    })
    const section = createFrameNode('Section', {
      id: 'section',
      parentId: page.id,
      layout: { ...defaultLayout(), position: 'flow' },
    })
    const source = documentWith([page, section])
    const repair = repairStackedLayout(source)

    expect(repair.flowed).toEqual([])
    expect(repair.unboxed).toEqual([])
    expect(repair.document.nodes).toEqual(source.nodes)
  })

  test('never moves canvas roots', () => {
    const page = createPageNode('Home', {
      id: 'page',
      layout: { ...defaultLayout(1440, 900), position: 'absolute', x: 0, y: 0 },
    })
    const repair = repairStackedLayout(documentWith([page]))

    expect(repair.flowed).toEqual([])
    expect(repair.document.nodes.page!.layout.position).toBe('absolute')
  })
})
