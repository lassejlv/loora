import { useEffect } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'bun:test'
import { CanvasEngine } from '@loora/canvas/engine'
import { CanvasProvider, useCanvasSession } from '@loora/canvas/react'
import {
  createCanvasDocument,
  createFrameNode,
  createPageNode,
  createTextNode,
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
  return document
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
function setup(ids: string[]) {
  const engine = new CanvasEngine(fixture())
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
})
