import { describe, expect, test } from 'bun:test'
import { pickBlockPageElement } from './block-page'
import type { CanvasElement } from './canvas'

function el(id: string, w: number, h: number): CanvasElement {
  return { id, name: id, x: 0, y: 0, w, h, code: '<div />' }
}

describe('pickBlockPageElement', () => {
  test('returns null for an empty canvas', () => {
    expect(pickBlockPageElement([], null)).toBeNull()
    expect(pickBlockPageElement([], 'missing')).toBeNull()
  })

  test('matches the element param when present', () => {
    const elements = [el('small', 10, 10), el('page', 1440, 900)]
    expect(pickBlockPageElement(elements, 'small')?.id).toBe('small')
  })

  test('falls back to the largest element without a param', () => {
    const elements = [el('a', 100, 100), el('page', 1440, 900), el('b', 300, 200)]
    expect(pickBlockPageElement(elements, null)?.id).toBe('page')
  })

  test('falls back to the largest element when the param does not match', () => {
    const elements = [el('a', 100, 100), el('page', 1440, 900)]
    expect(pickBlockPageElement(elements, 'gone')?.id).toBe('page')
  })

  test('keeps the earlier element on an area tie', () => {
    const elements = [el('first', 200, 200), el('second', 200, 200)]
    expect(pickBlockPageElement(elements, null)?.id).toBe('first')
  })
})
