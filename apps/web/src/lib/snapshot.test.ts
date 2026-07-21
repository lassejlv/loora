import { describe, expect, it } from 'bun:test'
import { CaptureCache, shouldReuseCapture } from './snapshot-cache'

describe('snapshot capture reuse', () => {
  const clean = { key: 'code:100:100', revision: 4, volatile: false }

  it('reuses a clean capture only when key and frame revision match', () => {
    expect(shouldReuseCapture(clean, clean.key, 4, 'reuse-clean')).toBe(true)
    expect(shouldReuseCapture(clean, 'changed:100:100', 4, 'reuse-clean')).toBe(false)
    expect(shouldReuseCapture(clean, clean.key, 5, 'reuse-clean')).toBe(false)
  })

  it('never reuses undated volatile captures or fresh requests', () => {
    expect(shouldReuseCapture({ ...clean, volatile: true }, clean.key, 4, 'reuse-clean')).toBe(false)
    expect(shouldReuseCapture(clean, clean.key, 4, 'fresh')).toBe(false)
  })

  it('reuses a recent volatile capture even when the revision moved on', () => {
    // Animated elements bump their revision every tick; a fresh-enough frame
    // of the same code is still representative.
    const animated = { ...clean, volatile: true, at: 10_000 }
    expect(shouldReuseCapture(animated, clean.key, 99, 'reuse-clean', 15_000)).toBe(true)
    expect(shouldReuseCapture(animated, clean.key, 99, 'reuse-clean', 25_000)).toBe(false)
    expect(shouldReuseCapture(animated, 'other:100:100', 99, 'reuse-clean', 15_000)).toBe(false)
    expect(shouldReuseCapture(animated, clean.key, 99, 'fresh', 15_000)).toBe(false)
  })

  it('evicts the least recently used capture at the configured bound', () => {
    const cache = new CaptureCache<typeof clean>(2)
    cache.set('a', clean)
    cache.set('b', { ...clean, revision: 5 })
    expect(cache.get('a')).toEqual(clean)

    cache.set('c', { ...clean, revision: 6 })

    expect(cache.size).toBe(2)
    expect(cache.has('a')).toBe(true)
    expect(cache.has('b')).toBe(false)
    expect(cache.has('c')).toBe(true)
  })
})
