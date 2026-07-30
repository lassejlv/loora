import { describe, expect, it } from 'bun:test'
import { mergeDocuments } from './merge'
import { createCanvasDocument, createFrameNode, createPageNode } from './model'

function fixture() {
  const document = createCanvasDocument('Fixture', 'doc')
  document.nodes.page = createPageNode('Home', { id: 'page' })
  document.nodes.hero = createFrameNode('Hero', {
    id: 'hero',
    parentId: 'page',
    order: 1024,
  })
  return document
}

describe('semantic Canvas merge', () => {
  it('merges independent fields on the same node', () => {
    const base = fixture()
    const left = structuredClone(base)
    const right = structuredClone(base)
    left.nodes.hero.layout.x = 100
    right.nodes.hero.name = 'Landing hero'
    const result = mergeDocuments(base, left, right)
    expect(result.unresolved).toEqual([])
    expect(result.document.nodes.hero.layout.x).toBe(100)
    expect(result.document.nodes.hero.name).toBe('Landing hero')
  })

  it('surfaces only the exact field changed in both', () => {
    const base = fixture()
    const left = structuredClone(base)
    const right = structuredClone(base)
    left.nodes.hero.layout.x = 100
    right.nodes.hero.layout.x = 200
    const unresolved = mergeDocuments(base, left, right)
    expect(unresolved.unresolved).toEqual(['node:hero:layout.x'])
    const resolved = mergeDocuments(base, left, right, {
      'node:hero:layout.x': 'right',
    })
    expect(resolved.document.nodes.hero.layout.x).toBe(200)
  })
})
