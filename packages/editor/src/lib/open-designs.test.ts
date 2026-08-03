import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  forgetOpenDesign,
  getOpenDesigns,
  rememberOpenDesign,
  useOpenDesigns,
} from './open-designs'

const STORAGE_KEY = 'loora:open-designs'

function reset() {
  for (const tab of [...getOpenDesigns()]) forgetOpenDesign(tab.id)
}

beforeEach(() => {
  reset()
  window.localStorage.clear()
})

afterEach(() => {
  reset()
})

describe('open designs store', () => {
  test('remembers a design and persists it', () => {
    rememberOpenDesign('d1', 'Young horizon')
    expect(getOpenDesigns()).toEqual([{ id: 'd1', name: 'Young horizon' }])
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain('Young horizon')
  })

  test('keeps one entry per design and refreshes its name', () => {
    rememberOpenDesign('d1', 'Young horizon')
    rememberOpenDesign('d2', 'Daring fern')
    rememberOpenDesign('d1', 'Young horizon renamed')
    expect(getOpenDesigns()).toEqual([
      { id: 'd1', name: 'Young horizon renamed' },
      { id: 'd2', name: 'Daring fern' },
    ])
  })

  test('falls back to Untitled for blank names', () => {
    rememberOpenDesign('d1', '   ')
    expect(getOpenDesigns()[0].name).toBe('Untitled')
  })

  test('forgets a design', () => {
    rememberOpenDesign('d1', 'Young horizon')
    rememberOpenDesign('d2', 'Daring fern')
    forgetOpenDesign('d1')
    expect(getOpenDesigns()).toEqual([{ id: 'd2', name: 'Daring fern' }])
  })

  test('notifies hook subscribers on change', () => {
    const { result } = renderHook(() => useOpenDesigns())
    act(() => rememberOpenDesign('d1', 'Young horizon'))
    expect(result.current).toEqual([{ id: 'd1', name: 'Young horizon' }])
  })

  test('picks up tabs written by another window', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: 'd9', name: 'From another window' }]),
    )
    const event = new Event('storage') as StorageEvent
    Object.defineProperty(event, 'key', { value: STORAGE_KEY })
    window.dispatchEvent(event)
    expect(getOpenDesigns()).toEqual([
      { id: 'd9', name: 'From another window' },
    ])
  })

  test('ignores malformed stored payloads', () => {
    window.localStorage.setItem(STORAGE_KEY, '{"broken": true')
    const event = new Event('storage') as StorageEvent
    Object.defineProperty(event, 'key', { value: STORAGE_KEY })
    window.dispatchEvent(event)
    expect(getOpenDesigns()).toEqual([])
  })
})
