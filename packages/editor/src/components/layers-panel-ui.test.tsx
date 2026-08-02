import { fireEvent, render } from '@testing-library/react'
import { describe, expect, vi, test } from 'vitest'
import { CanvasEngine } from '@loora/canvas/engine'
import {
  createCanvasDocument,
  createFrameNode,
  createPageNode,
  createTextNode,
} from '@loora/canvas/model'
import { CanvasProvider } from '@loora/canvas/react'
import { CanvasLayersPanel } from './layers-panel'

function fixture() {
  const document = createCanvasDocument('Layers UI', 'layers-ui')
  document.nodes.page = createPageNode('Page', { id: 'page' })
  document.nodes.frame = createFrameNode('Card', {
    id: 'frame',
    parentId: 'page',
  })
  document.nodes.text = createTextNode('Card title', {
    id: 'text',
    parentId: 'frame',
  })
  return document
}

describe('CanvasLayersPanel controls', () => {
  test('walks indexed children through expanded nested layers', () => {
    const view = render(
      <CanvasProvider engine={new CanvasEngine(fixture())}>
        <CanvasLayersPanel />
      </CanvasProvider>,
    )

    expect(view.getByText('Card')).toBeTruthy()
    expect(view.queryByText('Card title')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Expand layer' }))
    expect(view.getByText('Card title')).toBeTruthy()
  })

  test('creates pages and moves between dock positions', () => {
    const onAddPage = vi.fn()
    const onPositionChange = vi.fn()
    const view = render(
      <CanvasProvider engine={new CanvasEngine(fixture())}>
        <CanvasLayersPanel
          onAddPage={onAddPage}
          position="right"
          onPositionChange={onPositionChange}
        />
      </CanvasProvider>,
    )

    fireEvent.click(view.getByRole('button', { name: 'New page' }))
    fireEvent.click(
      view.getByRole('button', { name: 'Move layers panel to left' }),
    )
    fireEvent.click(
      view.getByRole('button', { name: 'Move layers panel to bottom' }),
    )

    expect(onAddPage).toHaveBeenCalledTimes(1)
    expect(onPositionChange.mock.calls.map(([position]) => position)).toEqual([
      'left',
      'bottom',
    ])
    expect(
      view.getByRole('button', { name: 'Move layers panel to right' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
  })
})
