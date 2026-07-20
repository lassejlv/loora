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
    const handles = container.querySelectorAll('svg rect[style]')
    const bottomRight = handles[handles.length - 2]

    fireEvent.pointerDown(bottomRight, { button: 0, pointerId: 2, clientX: 300, clientY: 100 })
    fireEvent.pointerMove(root, { pointerId: 2, clientX: 600, clientY: 200 })

    expect(onUpdateMany).toHaveBeenCalledTimes(1)
    const patches = onUpdateMany.mock.calls[0][0] as Map<string, { w: number; h: number }>
    expect(patches.size).toBe(2)
    expect(patches.get('a')?.w).toBe(200)
    expect(patches.get('b')?.w).toBe(200)
  })
})
