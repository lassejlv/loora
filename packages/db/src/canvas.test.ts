import { describe, expect, it } from 'bun:test'
import { legacyArray, type CanvasElement } from './canvas'

describe('legacyArray', () => {
  it('passes a real jsonb array through', () => {
    const value = [{ id: 'a' }, { id: 'b' }]
    expect(legacyArray(value)).toEqual(value)
  })

  it('parses the double-encoded string production mostly holds', () => {
    const elements: Partial<CanvasElement>[] = [
      { id: 'el1', name: 'Hero', code: '<div />' },
    ]
    expect(legacyArray<Partial<CanvasElement>>(JSON.stringify(elements))).toEqual(
      elements,
    )
  })

  it('yields an empty list instead of characters for junk', () => {
    // Iterating the raw string would have produced one "element" per character.
    expect(legacyArray('not json')).toEqual([])
    expect(legacyArray('"a string"')).toEqual([])
    expect(legacyArray(null)).toEqual([])
    expect(legacyArray(undefined)).toEqual([])
    expect(legacyArray({ nope: true })).toEqual([])
  })
})
