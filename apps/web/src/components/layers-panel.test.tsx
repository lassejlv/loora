import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { LayersPanel, type LayersPanelProps } from '#/components/layers-panel'
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

function renderPanel(overrides: Partial<LayersPanelProps> & Pick<LayersPanelProps, 'elements'>) {
  const props: LayersPanelProps = {
    selectedIds: [],
    onSelect: () => {},
    onReorderList: () => {},
    onRename: () => {},
    onSetFlags: () => {},
    onDuplicate: () => {},
    onDelete: () => {},
    onGroup: () => {},
    onUngroup: () => {},
    onRaise: () => {},
    onLower: () => {},
    ...overrides,
  }
  return render(<LayersPanel {...props} />)
}

describe('LayersPanel', () => {
  afterEach(() => cleanup())

  test('reorders with Alt+ArrowDown', () => {
    const onReorderList = mock(() => {})
    renderPanel({
      elements: [element({ id: 'bottom', name: 'Bottom' }), element({ id: 'top', name: 'Top' })],
      selectedIds: ['top'],
      onReorderList,
    })

    const top = screen.getByRole('treeitem', { name: /Top/ })
    act(() => {
      top.focus()
      fireEvent.keyDown(top, { key: 'ArrowDown', altKey: true })
    })

    expect(onReorderList).toHaveBeenCalledWith(['top', 'bottom'])
  })

  test('folds a group into one row and expands it on demand', () => {
    renderPanel({
      elements: [
        element({ id: 'a', name: 'Logo', groupId: 'g1' }),
        element({ id: 'b', name: 'Nav', groupId: 'g1' }),
        element({ id: 'c', name: 'Hero' }),
      ],
    })

    // Members are visible while the group is expanded (the default).
    expect(screen.getByRole('treeitem', { name: /Group of 2/ })).toBeTruthy()
    expect(screen.getByRole('treeitem', { name: /Logo/ })).toBeTruthy()

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Collapse group' }))
    })
    expect(screen.queryByRole('treeitem', { name: /Logo/ })).toBeNull()
  })

  test('selecting a group row selects every member', () => {
    const onSelect = mock((_ids: string[]) => {})
    renderPanel({
      elements: [
        element({ id: 'a', name: 'Logo', groupId: 'g1' }),
        element({ id: 'b', name: 'Nav', groupId: 'g1' }),
      ],
      onSelect,
    })

    act(() => {
      fireEvent.click(screen.getByRole('treeitem', { name: /Group of 2/ }))
    })
    // Rows are top-most first, so the group lists its members in that order.
    expect(onSelect).toHaveBeenCalledWith(['b', 'a'])
  })

  test('toggles hidden and locked for the row', () => {
    const onSetFlags = mock((_ids: string[], _patch: { hidden?: boolean; locked?: boolean }) => {})
    renderPanel({ elements: [element({ id: 'a', name: 'Hero' })], onSetFlags })

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Hide Hero' }))
    })
    expect(onSetFlags).toHaveBeenCalledWith(['a'], { hidden: true })

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Lock Hero' }))
    })
    expect(onSetFlags).toHaveBeenCalledWith(['a'], { locked: true })
  })

  test('offers to restore an already hidden layer', () => {
    renderPanel({ elements: [element({ id: 'a', name: 'Hero', hidden: true })] })
    expect(screen.getByRole('button', { name: 'Show Hero' })).toBeTruthy()
  })

  test('filters rows by name', () => {
    renderPanel({
      elements: [element({ id: 'a', name: 'Hero' }), element({ id: 'b', name: 'Footer' })],
    })

    act(() => {
      fireEvent.change(screen.getByLabelText('Search layers'), { target: { value: 'foot' } })
    })

    expect(screen.queryByRole('treeitem', { name: /Hero/ })).toBeNull()
    expect(screen.getByRole('treeitem', { name: /Footer/ })).toBeTruthy()
  })
})
