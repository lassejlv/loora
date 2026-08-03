import { useEffect } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { CanvasEngine } from '@loora/canvas/engine'
import { CanvasProvider, useCanvasSession } from '@loora/canvas/react'
import {
  createCanvasDocument,
  createFrameNode,
  createPageNode,
  createTextNode,
  createVectorNode,
  defaultLayout,
} from '@loora/canvas/model'
import { CanvasPropertiesPanel } from './properties-panel'

function fixture() {
  const document = createCanvasDocument('Inspector fixture', 'inspector')
  document.nodes.page = createPageNode('Home', { id: 'page' })
  document.nodes.card = createFrameNode('Card', {
    id: 'card',
    parentId: 'page',
    order: 1_024,
    layout: {
      ...defaultLayout(320, 200),
      position: 'absolute',
      x: 537.549560854,
      y: 292.5694285856,
      mode: 'flex',
      direction: 'column',
    },
  })
  document.nodes.other = createFrameNode('Other', {
    id: 'other',
    parentId: 'page',
    order: 2_048,
    layout: { ...defaultLayout(120, 80), position: 'absolute', x: 10, y: 20 },
  })
  document.nodes.label = createTextNode('Hello', {
    id: 'label',
    parentId: 'card',
    order: 1_024,
  })
  document.nodes.solidIcon = createVectorNode('Solid icon', {
    id: 'solidIcon',
    parentId: 'card',
    order: 2_048,
    paths: [{ d: 'M 0 0 h 24 v 24 z', fill: '#111827' }],
  })
  document.nodes.outlineIcon = createVectorNode('Outline icon', {
    id: 'outlineIcon',
    parentId: 'card',
    order: 3_072,
    paths: [{ d: 'M 2 2 L 22 22', stroke: '#111827', strokeWidth: 2 }],
  })
  return document
}

function withBrandToken(document: ReturnType<typeof fixture>) {
  document.tokens.brand = {
    id: 'brand',
    name: 'Brand',
    type: 'color',
    value: '#6d28d9',
  }
}

function Select({ ids }: { ids: string[] }) {
  const session = useCanvasSession()
  useEffect(() => {
    session.select(ids.map((nodeId) => ({ nodeId, instancePath: [] })))
  }, [ids.join(','), session])
  return null
}

/**
 * Queries are scoped to this render's own container: other suites in the same
 * process rewrite the shared document, and `screen` reads whatever body is
 * current rather than the one this panel was mounted into.
 */
function setup(
  ids: string[],
  prepare: (document: ReturnType<typeof fixture>) => void = () => {},
) {
  const document = fixture()
  prepare(document)
  const engine = new CanvasEngine(document)
  const view = render(
    <CanvasProvider engine={engine}>
      <Select ids={ids} />
      <CanvasPropertiesPanel />
    </CanvasProvider>,
  )
  return { engine, view }
}

const commit = (element: HTMLElement, value: string) => {
  fireEvent.change(element, { target: { value } })
  fireEvent.blur(element)
}

describe('CanvasPropertiesPanel', () => {
  afterEach(() => cleanup())

  test('rounds the numbers it shows instead of dumping raw floats', () => {
    const { view } = setup(['card'])
    expect((view.getByLabelText('X') as HTMLInputElement).value).toBe('537.55')
    expect((view.getByLabelText('Y') as HTMLInputElement).value).toBe('292.57')
  })

  test('shows the intact Page viewport when an old resize collapsed its layout', () => {
    const document = fixture()
    document.nodes.page = createPageNode('Home', {
      id: 'page',
      layout: defaultLayout(1, 1),
      viewport: { width: 800, minHeight: 900 },
    })
    const engine = new CanvasEngine(document)
    const view = render(
      <CanvasProvider engine={engine}>
        <Select ids={['page']} />
        <CanvasPropertiesPanel />
      </CanvasProvider>,
    )

    const width = view.getByLabelText('W') as HTMLInputElement
    const height = view.getByLabelText('H') as HTMLInputElement
    expect(width.value).toBe('800')
    expect(height.value).toBe('900')

    commit(width, '640')
    commit(height, '720')
    expect(engine.getNode('page')?.layout.width).toEqual({
      unit: 'px',
      value: 640,
    })
    expect(engine.getNode('page')?.layout.height).toEqual({
      unit: 'px',
      value: 720,
    })
    expect(engine.getNode('page')).toMatchObject({
      viewport: { width: 640, minHeight: 720 },
    })
  })

  test('keeps hug and fill sizing reachable', () => {
    const { engine, view } = setup(['card'])
    fireEvent.change(view.getByLabelText('W unit'), { target: { value: 'hug' } })
    expect(engine.getNode('card')?.layout.width).toEqual({ unit: 'hug' })

    fireEvent.change(view.getByLabelText('H unit'), { target: { value: 'percent' } })
    expect(engine.getNode('card')?.layout.height).toEqual({ unit: 'percent', value: 200 })
  })

  test('edits every selected layer at once and marks the values that differ', () => {
    const { engine, view } = setup(['card', 'other'])

    expect(view.getByText('2 layers selected')).toBeTruthy()
    const x = view.getByLabelText('X') as HTMLInputElement
    expect(x.value).toBe('')
    expect(x.placeholder).toBe('Mixed')

    commit(x, '64')
    expect(engine.getNode('card')?.layout.x).toBe(64)
    expect(engine.getNode('other')?.layout.x).toBe(64)
  })

  test('shows a shared value rather than Mixed when the selection agrees', () => {
    const { engine, view } = setup(['card', 'other'])
    const rotation = view.getByLabelText('Rot') as HTMLInputElement
    expect(rotation.value).toBe('0')

    commit(rotation, '15')
    expect(engine.getNode('card')?.rotation).toBe(15)
    expect(engine.getNode('other')?.rotation).toBe(15)
  })

  test('writes padding to every side while the sides are linked', () => {
    const { engine, view } = setup(['card'])
    commit(view.getByLabelText('T'), '12')
    expect(engine.getNode('card')?.layout.padding).toEqual({
      top: 12,
      right: 12,
      bottom: 12,
      left: 12,
    })
  })

  test('exposes auto-layout alignment for a flex parent', () => {
    const { engine, view } = setup(['card'])
    fireEvent.click(view.getByLabelText('Justify: Space between'))
    expect(engine.getNode('card')?.layout.justify).toBe('space-between')

    fireEvent.click(view.getByLabelText('Align: Center'))
    expect(engine.getNode('card')?.layout.align).toBe('center')
  })

  test('converts opacity between the percent shown and the value stored', () => {
    const { engine, view } = setup(['card'])
    const opacity = view.getByLabelText('Opacity') as HTMLInputElement
    expect(opacity.value).toBe('100')

    commit(opacity, '40')
    expect(engine.getNode('card')?.style.opacity).toBe(0.4)
  })

  test('adds and removes a stroke', () => {
    const { engine, view } = setup(['card'])
    fireEvent.click(view.getByRole('button', { name: 'Stroke' }))
    fireEvent.click(view.getByRole('button', { name: 'Add stroke' }))
    expect(engine.getNode('card')?.style.stroke).toEqual({
      color: '#000000',
      width: 1,
    })

    fireEvent.click(view.getByRole('button', { name: 'Remove stroke' }))
    expect(engine.getNode('card')?.style.stroke).toBeUndefined()
  })

  test('offers type controls only where there is type to edit', () => {
    const { engine, view } = setup(['label'])
    fireEvent.click(view.getByLabelText('Align: Center'))
    expect(engine.getNode('label')?.style.typography?.align).toBe('center')

    cleanup()
    const second = setup(['card'])
    expect(second.view.queryByLabelText('Font')).toBeNull()
  })

  test('recolors a filled vector through its fill', () => {
    const { engine, view } = setup(['solidIcon'])
    fireEvent.change(view.getByLabelText('Color'), {
      target: { value: '#ff0000' },
    })
    const node = engine.getNode('solidIcon')
    expect(node?.type === 'vector' && node.paths).toEqual([
      { d: 'M 0 0 h 24 v 24 z', fill: '#ff0000' },
    ])
    expect(view.queryByLabelText('Weight')).toBeNull()
  })

  test('recolors an outlined vector through its stroke, and sets its weight', () => {
    const { engine, view } = setup(['outlineIcon'])
    fireEvent.change(view.getByLabelText('Color'), {
      target: { value: '#00ff00' },
    })
    commit(view.getByLabelText('Weight'), '1.5')
    const node = engine.getNode('outlineIcon')
    expect(node?.type === 'vector' && node.paths).toEqual([
      { d: 'M 2 2 L 22 22', stroke: '#00ff00', strokeWidth: 1.5 },
    ])
  })

  test('recolors every selected vector at once, and hides the section otherwise', () => {
    const { engine, view } = setup(['solidIcon', 'outlineIcon'])
    // Both icons paint the same colour through different channels; the field
    // reads one value rather than "Mixed".
    expect((view.getByLabelText('Color hex') as HTMLInputElement).value).toBe(
      '#111827',
    )
    fireEvent.change(view.getByLabelText('Color'), {
      target: { value: '#0000ff' },
    })
    const solid = engine.getNode('solidIcon')
    const outline = engine.getNode('outlineIcon')
    expect(solid?.type === 'vector' && solid.paths[0]?.fill).toBe('#0000ff')
    expect(outline?.type === 'vector' && outline.paths[0]?.stroke).toBe('#0000ff')

    cleanup()
    expect(setup(['card']).view.queryByLabelText('Color')).toBeNull()
  })

  test('binds a colour to a token, and unbinding keeps what it painted', () => {
    const { engine, view } = setup(['solidIcon'], withBrandToken)
    fireEvent.change(view.getByLabelText('Color token'), {
      target: { value: 'brand' },
    })
    const bound = engine.getNode('solidIcon')
    expect(bound?.type === 'vector' && bound.paths[0]?.fill).toEqual({
      token: 'brand',
    })
    expect((view.getByLabelText('Color hex') as HTMLInputElement).value).toBe(
      'Brand',
    )

    fireEvent.change(view.getByLabelText('Color token'), { target: { value: '' } })
    const unbound = engine.getNode('solidIcon')
    expect(unbound?.type === 'vector' && unbound.paths[0]?.fill).toBe('#6d28d9')
  })

  test('offers the same tokens to fill, and none at all without any', () => {
    const { engine, view } = setup(['card'], withBrandToken)
    fireEvent.change(view.getByLabelText('Fill token'), {
      target: { value: 'brand' },
    })
    expect(engine.getNode('card')?.style.fills[0]).toEqual({
      type: 'solid',
      color: { token: 'brand' },
    })

    cleanup()
    expect(setup(['card']).view.queryByLabelText('Fill token')).toBeNull()
  })
})
