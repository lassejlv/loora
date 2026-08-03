import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { CanvasEngine } from '@loora/canvas/engine'
import { CanvasProvider } from '@loora/canvas/react'
import {
  createCanvasDocument,
  createFrameNode,
  createPageNode,
  defaultLayout,
  type CanvasDocument,
} from '@loora/canvas/model'
import { CanvasTokensPanel } from './tokens-panel'

function fixture() {
  const document = createCanvasDocument('Tokens fixture', 'tokens')
  document.nodes.page = createPageNode('Home', { id: 'page' })
  document.nodes.card = createFrameNode('Card', {
    id: 'card',
    parentId: 'page',
    order: 1_024,
    layout: defaultLayout(320, 200),
  })
  return document
}

function withTokens(document: CanvasDocument) {
  document.tokens.brand = {
    id: 'brand',
    name: 'Brand',
    type: 'color',
    value: '#6d28d9',
  }
  document.tokens.gap = { id: 'gap', name: 'Gap', type: 'number', value: 8 }
}

function setup(prepare: (document: CanvasDocument) => void = () => {}) {
  const document = fixture()
  prepare(document)
  const engine = new CanvasEngine(document)
  const view = render(
    <CanvasProvider engine={engine}>
      <CanvasTokensPanel />
    </CanvasProvider>,
  )
  return { engine, view }
}

describe('CanvasTokensPanel', () => {
  afterEach(() => cleanup())

  test('says so when a document defines no tokens', () => {
    const { view } = setup()
    expect(view.getByText('No tokens yet')).toBeTruthy()
    expect(view.queryByLabelText('Active')).toBeNull()
  })

  /** Radix opens on pointerdown and wants pointer-capture APIs jsdom lacks. */
  function openAddMenu(view: ReturnType<typeof setup>['view']) {
    const element = Element.prototype as unknown as Record<string, unknown>
    element.hasPointerCapture ??= () => false
    element.setPointerCapture ??= () => {}
    element.releasePointerCapture ??= () => {}
    element.scrollIntoView ??= () => {}
    fireEvent.pointerDown(view.getByLabelText('Add token'), {
      button: 0,
      ctrlKey: false,
      pointerType: 'mouse',
    })
    return within(view.baseElement)
  }

  test('adds a token from the header menu', () => {
    const { engine, view } = setup()
    const menu = openAddMenu(view)
    fireEvent.click(menu.getByRole('menuitem', { name: 'Color' }))
    expect(engine.document.tokens['color-1']).toEqual({
      id: 'color-1',
      name: 'Color 1',
      type: 'color',
      value: '#000000',
    })
  })

  test('renames a token and edits its value', () => {
    const { engine, view } = setup(withTokens)
    const name = view.getByLabelText('Brand name')
    fireEvent.change(name, { target: { value: 'Primary' } })
    fireEvent.blur(name)
    expect(engine.document.tokens.brand?.name).toBe('Primary')

    const value = view.getByLabelText('Primary hex')
    fireEvent.change(value, { target: { value: '#ff0000' } })
    fireEvent.blur(value)
    expect(engine.document.tokens.brand?.value).toBe('#ff0000')
  })

  test('refuses to delete a token something still points at', () => {
    const { engine, view } = setup((document) => {
      withTokens(document)
      document.nodes.card!.style.fills = [
        { type: 'solid', color: { token: 'brand' } },
      ]
    })
    expect(
      (view.getByLabelText('Delete Brand') as HTMLButtonElement).disabled,
    ).toBe(true)

    fireEvent.click(view.getByLabelText('Delete Gap'))
    expect(engine.document.tokens.gap).toBeUndefined()
    expect(engine.document.tokens.brand).toBeDefined()
  })

  test('writes into the active theme once a document has more than one', () => {
    const { engine, view } = setup((document) => {
      withTokens(document)
      document.themes.dark = { id: 'dark', name: 'Dark' }
      document.activeThemeId = 'dark'
    })
    expect(view.getByText('Editing values for Dark')).toBeTruthy()

    const value = view.getByLabelText('Brand hex')
    fireEvent.change(value, { target: { value: '#ffffff' } })
    fireEvent.blur(value)
    const token = engine.document.tokens.brand
    // The base value is what the other theme still paints, so it stays put.
    expect(token?.value).toBe('#6d28d9')
    expect(token?.modes).toEqual({ dark: '#ffffff' })

    fireEvent.change(view.getByLabelText('Active'), {
      target: { value: 'default' },
    })
    expect(engine.document.activeThemeId).toBe('default')
  })
})
