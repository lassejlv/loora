import { beforeEach, describe, expect, it } from 'bun:test'
import { hasStoredElements, loadElements, saveElements } from './docs'
import type { CanvasElement } from './canvas'

const shape: CanvasElement = {
  id: 'a',
  name: 'A',
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  code: '<div />',
}

describe('document shape cache', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: window.localStorage,
    })
    localStorage.clear()
  })

  it('distinguishes an uncached document from a cached empty canvas', () => {
    expect(hasStoredElements('doc')).toBe(false)
    saveElements('doc', [])
    expect(hasStoredElements('doc')).toBe(true)
    expect(loadElements('doc')).toEqual([])
  })

  it('round-trips cached shapes', () => {
    saveElements('doc', [shape])
    expect(loadElements('doc')).toEqual([shape])
  })
})
