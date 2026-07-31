import { describe, expect, test } from 'bun:test'
import { newDesignId, relativeTime } from './designs'

const NOW = Date.UTC(2026, 6, 27, 12, 0, 0)

describe('relativeTime', () => {
  test('reads as "just now" under a minute', () => {
    expect(relativeTime(NOW - 30_000, NOW)).toBe('just now')
    expect(relativeTime(NOW, NOW)).toBe('just now')
  })

  test('picks the largest unit that fits', () => {
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe('5 minutes ago')
    expect(relativeTime(NOW - 17 * 3_600_000, NOW)).toBe('17 hours ago')
    expect(relativeTime(NOW - 2 * 86_400_000, NOW)).toBe('2 days ago')
    expect(relativeTime(NOW - 3 * 604_800_000, NOW)).toBe('3 weeks ago')
    expect(relativeTime(NOW - 400 * 86_400_000, NOW)).toBe('last year')
  })
})

describe('newDesignId', () => {
  test('is prefixed and free of separators so it stays URL-safe', () => {
    const id = newDesignId()
    expect(id.startsWith('d')).toBe(true)
    expect(id).not.toContain('-')
    expect(encodeURIComponent(id)).toBe(id)
  })
})
