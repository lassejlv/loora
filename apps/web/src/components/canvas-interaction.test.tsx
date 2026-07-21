import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { Canvas } from './canvas'
import type { CanvasElement } from '#/lib/canvas'

const element = (id: string, x: number): CanvasElement => ({
  id,
  name: id,
  x,
  y: 0,
  w: 100,
  h: 100,
  code: '<div />',
})

afterEach(cleanup)

describe('Canvas batched interaction updates', () => {
  it('emits one patch batch for a multi-selection pointer move', () => {
    const onUpdateMany = mock()
    const { container } = render(
      <Canvas
        elements={[element('a', 0), element('b', 200)]}
        selectedIds={['a', 'b']}
        tool="select"
        onSelect={mock()}
        onToolChange={mock()}
        onCreate={mock()}
        onUpdateMany={onUpdateMany}
      />,
    )
    const root = container.firstElementChild as HTMLElement & { setPointerCapture?: (id: number) => void }
    root.setPointerCapture = mock()
    const hit = container.querySelector('[data-element-id="a"]')!

    fireEvent.pointerDown(hit, { button: 0, pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(root, { pointerId: 1, clientX: 25, clientY: 10 })

    expect(onUpdateMany).toHaveBeenCalledTimes(1)
    const patches = onUpdateMany.mock.calls[0][0] as Map<string, { x: number; y: number }>
    expect([...patches.keys()]).toEqual(['a', 'b'])
    expect(patches.get('a')).toEqual({ x: 25, y: 10 })
    expect(patches.get('b')).toEqual({ x: 225, y: 10 })
  })

  it('emits one patch batch for a multi-selection resize', () => {
    const onUpdateMany = mock()
    const { container } = render(
      <Canvas
        elements={[element('a', 0), element('b', 200)]}
        selectedIds={['a', 'b']}
        tool="select"
        onSelect={mock()}
        onToolChange={mock()}
        onCreate={mock()}
        onUpdateMany={onUpdateMany}
      />,
    )
    const root = container.firstElementChild as HTMLElement & { setPointerCapture?: (id: number) => void }
    root.setPointerCapture = mock()
    // Handle order: 4 corners then 4 edge midpoints; index 2 = bottom-right corner.
    const handles = container.querySelectorAll('svg rect[style]')
    expect(handles.length).toBe(8)
    const bottomRight = handles[2]

    fireEvent.pointerDown(bottomRight, { button: 0, pointerId: 2, clientX: 300, clientY: 100 })
    fireEvent.pointerMove(root, { pointerId: 2, clientX: 600, clientY: 200 })

    expect(onUpdateMany).toHaveBeenCalledTimes(1)
    const patches = onUpdateMany.mock.calls[0][0] as Map<string, { w: number; h: number }>
    expect(patches.size).toBe(2)
    expect(patches.get('a')?.w).toBe(200)
    expect(patches.get('b')?.w).toBe(200)
  })

  it('resizes a single axis from an edge handle', () => {
    const onUpdateMany = mock()
    const { container } = render(
      <Canvas
        elements={[element('a', 0)]}
        selectedIds={['a']}
        tool="select"
        onSelect={mock()}
        onToolChange={mock()}
        onCreate={mock()}
        onUpdateMany={onUpdateMany}
      />,
    )
    const root = container.firstElementChild as HTMLElement & { setPointerCapture?: (id: number) => void }
    root.setPointerCapture = mock()
    // Index 5 = right edge midpoint ([1, 0.5]).
    const rightEdge = container.querySelectorAll('svg rect[style]')[5]

    fireEvent.pointerDown(rightEdge, { button: 0, pointerId: 3, clientX: 100, clientY: 50 })
    fireEvent.pointerMove(root, { pointerId: 3, clientX: 150, clientY: 90 })

    expect(onUpdateMany).toHaveBeenCalledTimes(1)
    const patches = onUpdateMany.mock.calls[0][0] as Map<string, { x: number; y: number; w: number; h: number }>
    expect(patches.get('a')).toEqual({ x: 0, y: 0, w: 150, h: 100 })
  })

  it('rotates a single element from a corner rotate zone', () => {
    const onUpdateMany = mock()
    const { container } = render(
      <Canvas
        elements={[element('a', 0)]}
        selectedIds={['a']}
        tool="select"
        onSelect={mock()}
        onToolChange={mock()}
        onCreate={mock()}
        onUpdateMany={onUpdateMany}
      />,
    )
    const root = container.firstElementChild as HTMLElement & { setPointerCapture?: (id: number) => void }
    root.setPointerCapture = mock()
    const rotateZone = container.querySelector('svg circle')!

    // Start right of center, drag to below center: +90° around (50, 50).
    fireEvent.pointerDown(rotateZone, { button: 0, pointerId: 4, clientX: 100, clientY: 50 })
    fireEvent.pointerMove(root, { pointerId: 4, clientX: 50, clientY: 100 })

    expect(onUpdateMany).toHaveBeenCalledTimes(1)
    const patches = onUpdateMany.mock.calls[0][0] as Map<string, { r?: number }>
    expect(patches.get('a')?.r).toBe(90)
  })
})
