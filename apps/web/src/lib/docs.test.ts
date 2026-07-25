import { beforeEach, describe, expect, it } from 'bun:test'
import {
  deleteDocStorage,
  hasStoredElements,
  hasStoredTargetElements,
  loadActiveDraft,
  loadElements,
  loadTargetElements,
  saveActiveDraft,
  saveElements,
  saveTargetElements,
  targetKey,
} from './docs'
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

  it('keeps Main cache keys backward-compatible and isolates draft caches', () => {
    const main = { designId: 'doc', draftId: null }
    const draft = { designId: 'doc', draftId: 'draft-one' }

    saveTargetElements(main, [shape])
    saveTargetElements(draft, [{ ...shape, id: 'draft-shape' }])

    expect(localStorage.getItem('loora:doc:doc')).not.toBeNull()
    expect(loadTargetElements(main)).toEqual([shape])
    expect(loadTargetElements(draft)).toEqual([{ ...shape, id: 'draft-shape' }])
    expect(hasStoredTargetElements(draft)).toBe(true)
    expect(targetKey(main)).toBe('doc:main')
    expect(targetKey(draft)).toBe('doc:draft:draft-one')
  })

  it('removes Main and draft caches when a document is deleted', () => {
    saveElements('doc', [shape])
    saveTargetElements({ designId: 'doc', draftId: 'draft-one' }, [shape])

    deleteDocStorage('doc')

    expect(hasStoredElements('doc')).toBe(false)
    expect(hasStoredTargetElements({ designId: 'doc', draftId: 'draft-one' })).toBe(false)
  })
})

describe('active branch memory', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: window.localStorage,
    })
    localStorage.clear()
  })

  it('remembers a branch per design', () => {
    saveActiveDraft('d1', 'dr1')
    saveActiveDraft('d2', 'dr2')
    expect(loadActiveDraft('d1')).toBe('dr1')
    expect(loadActiveDraft('d2')).toBe('dr2')
    expect(loadActiveDraft('d3')).toBeNull()
  })

  it('forgets the branch when the design goes back to Main', () => {
    saveActiveDraft('d1', 'dr1')
    saveActiveDraft('d1', null)
    expect(loadActiveDraft('d1')).toBeNull()
  })

  it('drops the memory with the design', () => {
    saveActiveDraft('d1', 'dr1')
    deleteDocStorage('d1')
    expect(loadActiveDraft('d1')).toBeNull()
  })

  it('survives corrupt storage', () => {
    localStorage.setItem('loora:active-drafts', '{not json')
    expect(loadActiveDraft('d1')).toBeNull()
    saveActiveDraft('d1', 'dr1')
    expect(loadActiveDraft('d1')).toBe('dr1')
  })
})
