import { describe, expect, it } from 'bun:test'
import { CaptureCache, shouldReuseCapture } from './snapshot-cache'

describe('snapshot capture reuse', () => {
  const clean = { key: 'code:100:100', revision: 4, volatile: false }

  it('reuses a clean capture only when key and frame revision match', () => {
    expect(shouldReuseCapture(clean, clean.key, 4, 'reuse-clean')).toBe(true)
    expect(shouldReuseCapture(clean, 'changed:100:100', 4, 'reuse-clean')).toBe(false)
    expect(shouldReuseCapture(clean, clean.key, 5, 'reuse-clean')).toBe(false)
  })

  it('never reuses volatile captures or fresh requests', () => {
    expect(shouldReuseCapture({ ...clean, volatile: true }, clean.key, 4, 'reuse-clean')).toBe(false)
    expect(shouldReuseCapture(clean, clean.key, 4, 'fresh')).toBe(false)
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
