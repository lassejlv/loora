import { useEffect } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { CanvasEngine } from '@loora/canvas/engine'
import { CanvasProvider, useCanvasSession } from '@loora/canvas/react'
import {
  createCanvasDocument,
  createFrameNode,
  createPageNode,
  defaultLayout,
} from '@loora/canvas/model'
import { CanvasPropertiesPanel } from './properties-panel'

function fixture() {
  const document = createCanvasDocument('Motion fixture', 'motion')
  document.nodes.page = createPageNode('Home', { id: 'page' })
  document.nodes.card = createFrameNode('Card', {
    id: 'card',
    parentId: 'page',
    order: 1_024,
    layout: { ...defaultLayout(320, 200), position: 'absolute', x: 0, y: 0 },
  })
  document.nodes.other = createFrameNode('Other', {
    id: 'other',
    parentId: 'page',
    order: 2_048,
    layout: { ...defaultLayout(120, 80), position: 'absolute', x: 10, y: 20 },
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

/** Motion sits collapsed until asked for, so every test opens it first. */
function setup(ids: string[]) {
  const engine = new CanvasEngine(fixture())
  const view = render(
    <CanvasProvider engine={engine}>
      <Select ids={ids} />
      <CanvasPropertiesPanel />
    </CanvasProvider>,
  )
  fireEvent.click(view.getByRole('button', { name: 'Motion' }))
  return { engine, view }
}

describe('Motion section', () => {
  afterEach(() => cleanup())

  test('a hover preset brings its own transition', () => {
    const { engine, view } = setup(['card'])

    fireEvent.change(view.getByLabelText('Hover'), { target: { value: 'lift' } })

    const card = engine.document.nodes.card!
    expect(card.visualStates?.hover?.transform).toEqual({ y: -2, scale: 1.01 })
    expect(card.transition).toEqual({ duration: 180, easing: 'ease-out' })
  })

  test('picking a preset animation defines it on the document as it starts it', () => {
    const { engine, view } = setup(['card'])

    fireEvent.change(view.getByLabelText('Animation'), {
      target: { value: 'preset:fade-in-up' },
    })

    // One transaction: the definition and the reference land together, so the
    // document is never holding a reference to an animation it does not have.
    expect(engine.document.animations?.['fade-in-up']?.name).toBe('Fade in up')
    expect(engine.document.nodes.card?.animations).toEqual([
      { animationId: 'fade-in-up', trigger: 'load' },
    ])
    // One undo takes both away, which is the proof they arrived together.
    engine.undo()
    expect(engine.document.animations?.['fade-in-up']).toBeUndefined()
    expect(engine.document.nodes.card?.animations).toBeUndefined()
  })

  test('a trigger and a delay ride the animation already chosen', () => {
    const { engine, view } = setup(['card'])
    fireEvent.change(view.getByLabelText('Animation'), {
      target: { value: 'preset:fade-in-up' },
    })

    fireEvent.change(view.getByLabelText('Start'), { target: { value: 'in-view' } })
    fireEvent.change(view.getByLabelText('Delay'), { target: { value: '120' } })
    fireEvent.blur(view.getByLabelText('Delay'))

    expect(engine.document.nodes.card?.animations).toEqual([
      { animationId: 'fade-in-up', trigger: 'in-view', delay: 120 },
    ])
  })

  test('applies to everything selected at once', () => {
    const { engine, view } = setup(['card', 'other'])

    fireEvent.change(view.getByLabelText('Hover'), { target: { value: 'grow' } })

    expect(engine.document.nodes.card?.visualStates?.hover?.transform).toEqual({
      scale: 1.04,
    })
    expect(engine.document.nodes.other?.visualStates?.hover?.transform).toEqual({
      scale: 1.04,
    })
  })

  test('removing motion takes every part of it off', () => {
    const { engine, view } = setup(['card'])
    fireEvent.change(view.getByLabelText('Hover'), { target: { value: 'lift' } })
    fireEvent.change(view.getByLabelText('Animation'), {
      target: { value: 'preset:pulse' },
    })

    fireEvent.click(view.getByLabelText('Remove motion'))

    const card = engine.document.nodes.card!
    expect(card.visualStates).toBeUndefined()
    expect(card.transition).toBeUndefined()
    expect(card.animations).toBeUndefined()
    // The definition stays on the document — other nodes may still be using it.
    expect(engine.document.animations?.pulse).toBeDefined()
  })
})
