import { fireEvent, render } from '@testing-library/react'
import { describe, expect, mock, test } from 'bun:test'
import { CanvasEngine } from '@loora/canvas/engine'
import {
  createCanvasDocument,
  createPageNode,
} from '@loora/canvas/model'
import { CanvasProvider } from '@loora/canvas/react'
import { CanvasLayersPanel } from './layers-panel'

function fixture() {
  const document = createCanvasDocument('Layers UI', 'layers-ui')
  document.nodes.page = createPageNode('Page', { id: 'page' })
  return document
}

describe('CanvasLayersPanel controls', () => {
  test('creates pages and moves between dock positions', () => {
    const onAddPage = mock()
    const onPositionChange = mock()
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
