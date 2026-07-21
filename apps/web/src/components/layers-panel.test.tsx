import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { LayersPanel } from '#/components/layers-panel'
import type { CanvasElement } from '#/lib/canvas'

function element(partial: Partial<CanvasElement> & Pick<CanvasElement, 'id' | 'name'>): CanvasElement {
  return {
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    code: '<div />',
    ...partial,
  }
}

describe('LayersPanel', () => {
  afterEach(() => cleanup())

  test('reorders with Alt+ArrowDown', () => {
    const onReorderList = mock(() => {})
    const elements = [
      element({ id: 'bottom', name: 'Bottom' }),
      element({ id: 'top', name: 'Top' }),
    ]

    render(
      <LayersPanel
        elements={elements}
        selectedIds={['top']}
        onSelect={() => {}}
        onReorderList={onReorderList}
        onRename={() => {}}
      />,
    )

    const top = screen.getByRole('option', { name: 'Top' })
    act(() => {
      top.focus()
      fireEvent.keyDown(top, { key: 'ArrowDown', altKey: true })
    })

    expect(onReorderList).toHaveBeenCalledWith(['top', 'bottom'])
  })
})
