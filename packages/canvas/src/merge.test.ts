import { describe, expect, it } from 'vitest'
import { mergeDocuments, diffDocuments, changedNodeIds } from './merge'
import { createCanvasDocument, createFrameNode, createPageNode, type CanvasAnimation } from './model'

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

  it('resolves a conflict to the left side', () => {
    const base = fixture()
    const left = structuredClone(base)
    const right = structuredClone(base)
    left.nodes.hero.layout.y = 50
    right.nodes.hero.layout.y = 90
    const result = mergeDocuments(base, left, right, {
      'node:hero:layout.y': 'left',
    })
    expect(result.unresolved).toEqual([])
    expect(result.document.nodes.hero.layout.y).toBe(50)
  })

  it('merges a node added on the left with a change on the right', () => {
    const base = fixture()
    const left = structuredClone(base)
    const right = structuredClone(base)
    left.nodes.footer = createFrameNode('Footer', {
      id: 'footer',
      parentId: 'page',
      order: 2048,
    })
    right.nodes.hero.name = 'Updated hero'
    const result = mergeDocuments(base, left, right)
    expect(result.unresolved).toEqual([])
    expect(result.document.nodes.footer).toBeDefined()
    expect(result.document.nodes.footer.name).toBe('Footer')
    expect(result.document.nodes.hero.name).toBe('Updated hero')
  })

  it('surfaces a conflict when both sides add different nodes with the same id', () => {
    const base = fixture()
    const left = structuredClone(base)
    const right = structuredClone(base)
    left.nodes.card = createFrameNode('Left card', { id: 'card', parentId: 'page', order: 2048 })
    right.nodes.card = createFrameNode('Right card', { id: 'card', parentId: 'page', order: 2048 })
    const result = mergeDocuments(base, left, right)
    expect(result.unresolved).toContain('node:card:name')
    expect(result.conflicts[0].scope).toBe('node')
    expect(result.conflicts[0].targetId).toBe('card')
  })

  it('removes a node deleted on one side and unchanged on the other', () => {
    const base = fixture()
    const left = structuredClone(base)
    const right = structuredClone(base)
    delete left.nodes.hero
    const result = mergeDocuments(base, left, right)
    expect(result.unresolved).toEqual([])
    expect(result.document.nodes.hero).toBeUndefined()
  })

  it('surfaces a conflict when one side deletes and the other modifies', () => {
    const base = fixture()
    const left = structuredClone(base)
    const right = structuredClone(base)
    delete left.nodes.hero
    right.nodes.hero.name = 'Changed hero'
    const result = mergeDocuments(base, left, right)
    expect(result.unresolved).toContain('node:hero:$')
  })

  it('merges tokens added on different sides', () => {
    const base = fixture()
    const left = structuredClone(base)
    const right = structuredClone(base)
    left.tokens = {
      ...left.tokens,
      colorPrimary: { id: 'colorPrimary', type: 'color', name: 'Primary', value: '#3b82f6' },
    }
    right.tokens = {
      ...right.tokens,
      colorSecondary: { id: 'colorSecondary', type: 'color', name: 'Secondary', value: '#94a3b8' },
    }
    const result = mergeDocuments(base, left, right)
    expect(result.unresolved).toEqual([])
    expect(result.document.tokens.colorPrimary).toBeDefined()
    expect(result.document.tokens.colorSecondary).toBeDefined()
  })

  it('merges animations added on different sides', () => {
    const base = fixture()
    const left = structuredClone(base)
    const right = structuredClone(base)
    left.animations = {
      'anim-fade': {
        id: 'anim-fade',
        name: 'fade-in',
        keyframes: [
          { offset: 0, opacity: 0 },
          { offset: 1, opacity: 1 },
        ],
        duration: 300,
        easing: 'ease',
        iterations: 1,
        direction: 'normal',
        fill: 'both',
      } as CanvasAnimation,
    }
    right.animations = {
      'anim-slide': {
        id: 'anim-slide',
        name: 'slide-in',
        keyframes: [
          { offset: 0, opacity: 0, transform: { x: -20, scaleX: 1, scaleY: 1 } },
          { offset: 1, opacity: 1, transform: { x: 0, scaleX: 1, scaleY: 1 } },
        ],
        duration: 400,
        easing: 'ease-out',
        iterations: 1,
        direction: 'normal',
        fill: 'both',
      } as CanvasAnimation,
    }
    const result = mergeDocuments(base, left, right)
    expect(result.unresolved).toEqual([])
    expect(result.document.animations!['anim-fade']).toBeDefined()
    expect(result.document.animations!['anim-slide']).toBeDefined()
  })

  it('surfaces a conflict when both sides change the same animation', () => {
    const base = fixture()
    base.animations = {
      'anim-1': {
        id: 'anim-1',
        name: 'fade',
        keyframes: [
          { offset: 0, opacity: 0 },
          { offset: 1, opacity: 1 },
        ],
        duration: 300,
        easing: 'ease',
        iterations: 1,
        direction: 'normal',
        fill: 'both',
      } as CanvasAnimation,
    }
    const left = structuredClone(base)
    const right = structuredClone(base)
    left.animations!['anim-1'].duration = 200
    right.animations!['anim-1'].duration = 500
    const result = mergeDocuments(base, left, right)
    expect(result.unresolved).toContain('document:doc:animations.anim-1.duration')
  })

  it('merges document name changes on different sides', () => {
    const base = fixture()
    const left = structuredClone(base)
    const right = structuredClone(base)
    left.name = 'Left doc'
    const result = mergeDocuments(base, left, right)
    expect(result.document.name).toBe('Left doc')
  })

  it('surfaces a conflict when both sides change the document name', () => {
    const base = fixture()
    const left = structuredClone(base)
    const right = structuredClone(base)
    left.name = 'Left name'
    right.name = 'Right name'
    const result = mergeDocuments(base, left, right)
    expect(result.unresolved).toContain('document:doc:name')
  })

  it('produces a diff summary', () => {
    const base = fixture()
    const next = structuredClone(base)
    next.nodes.hero.name = 'Changed'
    next.nodes.card = createFrameNode('Card', { id: 'card', parentId: 'page', order: 2048 })
    const summary = diffDocuments(base, next)
    expect(summary).toEqual({ added: 1, removed: 0, changed: 1 })
  })

  it('finds changed node ids', () => {
    const base = fixture()
    const next = structuredClone(base)
    next.nodes.hero.name = 'Changed'
    next.nodes.card = createFrameNode('Card', { id: 'card', parentId: 'page', order: 2048 })
    const ids = changedNodeIds(base, next)
    expect(ids).toContain('hero')
    expect(ids).toContain('card')
  })

  it('includes conflict objects with base, left, and right values', () => {
    const base = fixture()
    const left = structuredClone(base)
    const right = structuredClone(base)
    left.nodes.hero.layout.x = 100
    right.nodes.hero.layout.x = 200
    const result = mergeDocuments(base, left, right)
    expect(result.conflicts).toHaveLength(1)
    const conflict = result.conflicts[0]
    expect(conflict.scope).toBe('node')
    expect(conflict.targetId).toBe('hero')
    expect(conflict.path).toBe('layout.x')
    expect(conflict.base).toBe(0)
    expect(conflict.left).toBe(100)
    expect(conflict.right).toBe(200)
  })
})