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

  test('keeps the MCP integration deep-link', () => {
    window.history.replaceState({}, '', '/?settings=integrations&integration=mcp')
    expect(bootstrapEditorSearch('doc_1')).toEqual({
      d: 'doc_1',
      settings: 'integrations',
      integration: 'mcp',
    })
  })

  test('drops retired AI provider deep-links', () => {
    window.history.replaceState({}, '', '/?settings=chatgpt')
    expect(bootstrapEditorSearch('doc_1')).toEqual({ d: 'doc_1' })

    window.history.replaceState({}, '', '/?settings=agent')
    expect(bootstrapEditorSearch('doc_1')).toEqual({ d: 'doc_1' })

    window.history.replaceState({}, '', '/?settings=integrations&integration=providers')
    expect(bootstrapEditorSearch('doc_1')).toEqual({
      d: 'doc_1',
      settings: 'integrations',
    })
  })

  test('seeds layers from localStorage when URL omits it', () => {
    window.localStorage.setItem('loora:layers', '1')
    window.history.replaceState({}, '', '/?d=doc_1')
    expect(bootstrapEditorSearch('doc_1')).toEqual({ layers: true })
  })
})
