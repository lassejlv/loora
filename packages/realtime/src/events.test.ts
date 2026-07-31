import { describe, expect, test } from 'bun:test'
import {
  normalizePresenceInput,
  scopePresenceSessionId,
} from './events'

describe('presence keys', () => {
  test('scopes a room key to the account that holds it', () => {
    expect(scopePresenceSessionId('user-1', 'tab-a')).toBe('user-1:tab-a')
    // Two people proposing the same tab id land on different keys, so neither
    // can overwrite or clear the other's cursor.
    expect(scopePresenceSessionId('user-2', 'tab-a')).not.toBe(
      scopePresenceSessionId('user-1', 'tab-a'),
    )
  })

  test('stays inside the length the wire protocol accepts', () => {
    const key = scopePresenceSessionId('u'.repeat(200), 't'.repeat(200))

    expect(key.length).toBeLessThanOrEqual(128)
  })
})

describe('presence input', () => {
  test('rounds a cursor and drops one that is not a position', () => {
    expect(
      normalizePresenceInput({ cursor: { x: 4.6, y: -2.2 }, selection: [] }),
    ).toEqual({ cursor: { x: 5, y: -2 }, selection: [] })
    expect(normalizePresenceInput({ cursor: { x: 'far', y: 0 } })).toEqual({
      cursor: null,
      selection: [],
    })
    expect(normalizePresenceInput(null)).toBeNull()
  })

  test('caps a selection', () => {
    const selection = Array.from({ length: 100 }, (_, index) => `node-${index}`)

    expect(normalizePresenceInput({ selection })?.selection).toHaveLength(64)
  })
})
