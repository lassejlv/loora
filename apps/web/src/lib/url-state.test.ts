import { afterEach, describe, expect, test } from 'bun:test'
import { bootstrapEditorSearch } from '#/lib/url-state'

describe('bootstrapEditorSearch', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/')
    window.localStorage.clear()
  })

  test('seeds design id when missing', () => {
    window.history.replaceState({}, '', '/')
    expect(bootstrapEditorSearch('doc_1')).toEqual({ d: 'doc_1' })
  })

  test('maps legacy integration deep-links', () => {
    window.history.replaceState({}, '', '/?settings=github')
    expect(bootstrapEditorSearch('doc_1')).toEqual({
      d: 'doc_1',
      settings: 'integrations',
      integration: 'github',
    })
  })

  test('opens billing on topup success', () => {
    window.history.replaceState({}, '', '/?topup=success')
    expect(bootstrapEditorSearch('doc_1')).toEqual({
      d: 'doc_1',
      settings: 'billing',
    })
  })

  test('seeds agent/layers from localStorage when URL omits them', () => {
    window.localStorage.setItem('loora:agent', '0')
    window.localStorage.setItem('loora:layers', '1')
    window.history.replaceState({}, '', '/?d=doc_1')
    expect(bootstrapEditorSearch('doc_1')).toEqual({
      agent: false,
      layers: true,
    })
  })
})
