import { describe, expect, it } from 'bun:test'
import { collectSnapLines, elementAABB, snapBox, snapPoint } from './snap'
import type { CanvasElement } from './canvas'

const el = (id: string, x: number, y: number, w: number, h: number, r?: number): CanvasElement => ({
  id,
  name: id,
  x,
  y,
  w,
  h,
  code: '',
  ...(r !== undefined ? { r } : {}),
})

describe('elementAABB', () => {
  it('is the element box when unrotated', () => {
    expect(elementAABB(el('a', 10, 20, 100, 50))).toEqual({
      left: 10,
      top: 20,
      right: 110,
      bottom: 70,
    })
  })

  it('expands around the center for a rotated element', () => {
    const box = elementAABB(el('a', 0, 0, 100, 50, 90))
    // 90°: width and height swap around the center (50, 25).
    expect(box.left).toBeCloseTo(25)
    expect(box.right).toBeCloseTo(75)
    expect(box.top).toBeCloseTo(-25)
    expect(box.bottom).toBeCloseTo(75)
  })

  it('treats full turns as unrotated', () => {
    expect(elementAABB(el('a', 0, 0, 100, 50, 360))).toEqual({
      left: 0,
      top: 0,
      right: 100,
      bottom: 50,
    })
  })
})

describe('collectSnapLines', () => {
  it('collects edges and centers, skipping excluded ids', () => {
    const lines = collectSnapLines([el('a', 0, 0, 100, 100), el('b', 500, 0, 10, 10)], new Set(['b']))
    expect(lines.xs).toEqual([0, 50, 100])
    expect(lines.ys).toEqual([0, 50, 100])
  })
})

describe('snapBox', () => {
  const lines = { xs: [100, 150, 200], ys: [300] }

  it('returns the correction that lands the nearest edge on a line', () => {
    // Box left edge at 104 → snaps to the line at 100 (correction -4… line - edge).
    const result = snapBox({ left: 104, top: 0, right: 154, bottom: 50 }, lines, 6)
    expect(result.dx).toBe(-4)
    expect(result.vLine).toBe(100)
  })

  it('prefers the smallest correction across edges and center', () => {
    // Right edge at 199 (corr +1 to 200) beats left edge at 149 (corr +1 to 150)?
    // Both are 1 — first found wins; assert a clearly smaller one.
    const result = snapBox({ left: 120, top: 0, right: 199.5, bottom: 10 }, lines, 6)
    expect(result.vLine).toBe(200)
    expect(result.dx).toBeCloseTo(0.5)
  })

  it('ignores lines beyond the threshold', () => {
    const result = snapBox({ left: 400, top: 400, right: 500, bottom: 500 }, lines, 6)
    expect(result.dx).toBe(0)
    expect(result.dy).toBe(0)
    expect(result.vLine).toBeNull()
    expect(result.hLine).toBeNull()
  })
})

describe('snapPoint', () => {
  const lines = { xs: [100], ys: [200] }

  it('snaps each axis independently', () => {
    const result = snapPoint({ x: 103, y: 197 }, lines, 6)
    expect(result.x).toBe(100)
    expect(result.y).toBe(200)
    expect(result.vLine).toBe(100)
    expect(result.hLine).toBe(200)
  })

  it('leaves a disabled axis untouched (edge-handle resize)', () => {
    const result = snapPoint({ x: 103, y: 197 }, lines, 6, { snapX: false })
    expect(result.x).toBe(103)
    expect(result.vLine).toBeNull()
    expect(result.y).toBe(200)
  })

  it('passes the point through outside the threshold', () => {
    const result = snapPoint({ x: 120, y: 220 }, lines, 6)
    expect(result.x).toBe(120)
    expect(result.y).toBe(220)
  })
})
