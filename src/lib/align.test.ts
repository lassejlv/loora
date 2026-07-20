import { describe, expect, it } from 'bun:test'
import type { CanvasElement } from './canvas'
import { alignElements, distributeElements } from './align'

const el = (id: string, x: number, y: number, w = 100, h = 50): CanvasElement => ({
  id,
  name: id,
  x,
  y,
  w,
  h,
  code: '<div />',
})

describe('alignElements', () => {
  const elements = [el('a', 0, 0), el('b', 200, 100, 60, 30), el('c', 500, 500)]

  it('aligns left edges to the leftmost element', () => {
    const out = alignElements(elements, ['a', 'b'], 'left')
    expect(out.find((s) => s.id === 'a')!.x).toBe(0)
    expect(out.find((s) => s.id === 'b')!.x).toBe(0)
    // unselected untouched
    expect(out.find((s) => s.id === 'c')!.x).toBe(500)
  })

  it('aligns right edges to the rightmost element', () => {
    const out = alignElements(elements, ['a', 'b'], 'right')
    expect(out.find((s) => s.id === 'a')!.x).toBe(160) // 260 - 100
    expect(out.find((s) => s.id === 'b')!.x).toBe(200) // 260 - 60
  })

  it('centers horizontally inside the selection bounds', () => {
    const out = alignElements(elements, ['a', 'b'], 'centerX')
    // bounds 0..260, center 130
    expect(out.find((s) => s.id === 'a')!.x).toBe(80) // 130 - 50
    expect(out.find((s) => s.id === 'b')!.x).toBe(100) // 130 - 30
  })

  it('aligns top and bottom edges', () => {
    const top = alignElements(elements, ['a', 'b'], 'top')
    expect(top.find((s) => s.id === 'b')!.y).toBe(0)
    const bottom = alignElements(elements, ['a', 'b'], 'bottom')
    // bounds bottom = 130
    expect(bottom.find((s) => s.id === 'a')!.y).toBe(80)
    expect(bottom.find((s) => s.id === 'b')!.y).toBe(100)
  })

  it('is a no-op for fewer than two selected', () => {
    expect(alignElements(elements, ['a'], 'left')).toBe(elements)
  })
})

describe('distributeElements', () => {
  it('spaces elements evenly, keeping the outermost fixed', () => {
    const elements = [el('a', 0, 0), el('b', 120, 0), el('c', 400, 0)]
    const out = distributeElements(elements, ['a', 'b', 'c'], 'x')
    // span 0..500, sizes 300, gaps = (500 - 300) / 2 = 100
    expect(out.find((s) => s.id === 'a')!.x).toBe(0)
    expect(out.find((s) => s.id === 'b')!.x).toBe(200)
    expect(out.find((s) => s.id === 'c')!.x).toBe(400)
  })

  it('distributes vertically', () => {
    const elements = [el('a', 0, 0), el('b', 0, 60), el('c', 0, 300)]
    const out = distributeElements(elements, ['a', 'b', 'c'], 'y')
    // span 0..350, sizes 150, gap = 100
    expect(out.find((s) => s.id === 'b')!.y).toBe(150)
  })

  it('is a no-op for fewer than three selected', () => {
    const elements = [el('a', 0, 0), el('b', 300, 0)]
    expect(distributeElements(elements, ['a', 'b'], 'x')).toBe(elements)
  })
})
