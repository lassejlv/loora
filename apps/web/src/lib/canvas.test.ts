import { describe, expect, it } from 'bun:test'
import { applyElementPatches, reorderElements, type CanvasElement } from './canvas'

const element = (id: string, x = 0): CanvasElement => ({
  id,
  name: id,
  x,
  y: 0,
  w: 100,
  h: 100,
  code: '<div />',
})

describe('applyElementPatches', () => {
  it('applies a batch in one array pass and preserves untouched object identity', () => {
    const a = element('a')
    const b = element('b')
    const c = element('c')
    const out = applyElementPatches(
      [a, b, c],
      new Map([
        ['a', { x: 10 }],
        ['c', { x: 30, name: 'changed' }],
      ]),
    )

    expect(out.map(({ id, x }) => ({ id, x }))).toEqual([
      { id: 'a', x: 10 },
      { id: 'b', x: 0 },
      { id: 'c', x: 30 },
    ])
    expect(out[1]).toBe(b)
    expect(out[0]).not.toBe(a)
  })

  it('returns the original array for an empty batch', () => {
    const elements = [element('a')]
    expect(applyElementPatches(elements, new Map())).toBe(elements)
  })
})

describe('reorderElements', () => {
  it('rebuilds exact order in linear time', () => {
    const elements = [element('a'), element('b'), element('c')]
    expect(reorderElements(elements, ['c', 'a', 'b']).map((item) => item.id)).toEqual(['c', 'a', 'b'])
  })

  it('ignores duplicate and unknown ids and preserves omitted relative order', () => {
    const elements = [element('a'), element('b'), element('c'), element('d')]
    expect(reorderElements(elements, ['c', 'missing', 'c', 'a']).map((item) => item.id)).toEqual([
      'c',
      'a',
      'b',
      'd',
    ])
  })
})
