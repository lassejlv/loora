import { describe, expect, it } from 'bun:test'
import { compareHistoryKeys, sortCommitsOldestFirst, toHistoryPage } from './history'

describe('history summaries and ordering', () => {
  it('uses timestamp and id as a deterministic ordering key', () => {
    const versions = [
      { id: 'b', at: 20 },
      { id: 'a', at: 20 },
      { id: 'z', at: 10 },
    ]

    expect([...versions].sort(compareHistoryKeys).map((version) => version.id)).toEqual([
      'z',
      'a',
      'b',
    ])
    expect(sortCommitsOldestFirst(versions).map((version) => version.id)).toEqual([
      'z',
      'a',
      'b',
    ])
  })

  it('builds a bounded metadata-only page and cursor', () => {
    const rows = [
      {
        id: 'c',
        message: 'Third',
        added: 1,
        removed: 0,
        changed: 0,
        createdAt: new Date(30),
        shapes: [{ id: 'must-not-leak' }],
      },
      {
        id: 'b',
        message: 'Second',
        added: 0,
        removed: 1,
        changed: 0,
        createdAt: new Date(20),
        shapes: [],
      },
      {
        id: 'a',
        message: 'First',
        added: 0,
        removed: 0,
        changed: 1,
        createdAt: new Date(10),
        shapes: [],
      },
    ]

    const page = toHistoryPage(rows, 2)

    expect(page.items).toEqual([
      { id: 'c', message: 'Third', added: 1, removed: 0, changed: 0, at: 30 },
      { id: 'b', message: 'Second', added: 0, removed: 1, changed: 0, at: 20 },
    ])
    expect(page.nextCursor).toEqual({ at: 20, id: 'b' })
    expect(page.items.some((item) => 'shapes' in item)).toBe(false)
  })
})
