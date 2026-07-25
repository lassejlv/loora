import { describe, expect, test } from 'bun:test'
import type { CanvasElement, CanvasPage } from './canvas'
import { canvasDiff, mergeCanvas } from './drafts'

const shape = (id: string, patch: Partial<CanvasElement> = {}): CanvasElement => ({
  id,
  name: id,
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  code: `<div>${id}</div>`,
  ...patch,
})

const page = (id: string, patch: Partial<CanvasPage> = {}): CanvasPage => ({
  id,
  name: id,
  x: 200,
  y: 0,
  w: 100,
  items: [{ id: `${id}-item`, elementId: 'a', height: 100 }],
  ...patch,
})

describe('canvas drafts', () => {
  test('summarizes additions, removals, and changes', () => {
    expect(canvasDiff([shape('a'), shape('b')], [shape('b', { x: 20 }), shape('c')])).toEqual({
      added: 1,
      removed: 1,
      changed: 1,
    })
  })

  test('merges independent element changes', () => {
    const base = [shape('a'), shape('b')]
    const result = mergeCanvas(
      base,
      [shape('a', { x: 20 }), shape('b')],
      [shape('a'), shape('b', { code: '<main />' })],
    )

    expect(result.unresolved).toEqual([])
    expect(result.shapes).toEqual([
      shape('a', { x: 20 }),
      shape('b', { code: '<main />' }),
    ])
  })

  test('merges one-sided additions and deletions', () => {
    const result = mergeCanvas(
      [shape('a'), shape('b')],
      [shape('a'), shape('b'), shape('main')],
      [shape('b'), shape('draft')],
    )

    expect(result.unresolved).toEqual([])
    expect(result.shapes.map(({ id }) => id)).toEqual(['b', 'main', 'draft'])
  })

  test('accepts identical edits on both sides', () => {
    const edited = shape('a', { name: 'Edited' })
    const result = mergeCanvas([shape('a')], [edited], [edited])

    expect(result.conflicts).toEqual([])
    expect(result.shapes).toEqual([edited])
  })

  test('requires a choice for divergent edits', () => {
    const base = [shape('a')]
    const main = [shape('a', { name: 'Main' })]
    const draft = [shape('a', { name: 'Draft' })]

    expect(mergeCanvas(base, main, draft).unresolved).toEqual(['element:a'])
    expect(mergeCanvas(base, main, draft, { 'element:a': 'draft' }).shapes).toEqual(draft)
  })

  test('treats edit versus delete as a conflict', () => {
    const base = [shape('a')]
    const main = [shape('a', { x: 10 })]
    const result = mergeCanvas(base, main, [])

    expect(result.unresolved).toEqual(['element:a'])
    expect(mergeCanvas(base, main, [], { 'element:a': 'draft' }).shapes).toEqual([])
  })

  test('detects incompatible layer reordering', () => {
    const base = [shape('a'), shape('b'), shape('c')]
    const main = [shape('b'), shape('a'), shape('c')]
    const draft = [shape('a'), shape('c'), shape('b')]
    const result = mergeCanvas(base, main, draft)

    expect(result.unresolved).toEqual(['order'])
    expect(result.shapes.map(({ id }) => id)).toEqual(['b', 'a', 'c'])
    expect(mergeCanvas(base, main, draft, { order: 'draft' }).shapes.map(({ id }) => id)).toEqual([
      'a',
      'c',
      'b',
    ])
  })

  test('applies a one-sided layer reorder without conflict', () => {
    const base = [shape('a'), shape('b')]
    const result = mergeCanvas(base, base, [shape('b'), shape('a')])

    expect(result.unresolved).toEqual([])
    expect(result.shapes.map(({ id }) => id)).toEqual(['b', 'a'])
  })

  test('merges independent Page changes with element changes', () => {
    const result = mergeCanvas(
      [shape('a')],
      [shape('a', { x: 10 })],
      [shape('a')],
      {},
      [page('home')],
      [page('home')],
      [page('home', { name: 'Landing' })],
    )

    expect(result.unresolved).toEqual([])
    expect(result.shapes[0].x).toBe(10)
    expect(result.pages).toEqual([page('home', { name: 'Landing' })])
    expect(result.summary).toEqual({ added: 0, removed: 0, changed: 1 })
  })

  test('requires a choice for divergent Page edits and ordering', () => {
    const basePages = [page('home'), page('pricing'), page('about')]
    const mainPages = [
      page('pricing'),
      page('home', { name: 'Main home' }),
      page('about'),
    ]
    const draftPages = [
      page('home', { name: 'Draft home' }),
      page('about'),
      page('pricing'),
    ]
    const result = mergeCanvas([], [], [], {}, basePages, mainPages, draftPages)

    expect(result.unresolved).toEqual(['page:home', 'page-order'])
    const resolved = mergeCanvas(
      [],
      [],
      [],
      { 'page:home': 'draft', 'page-order': 'draft' },
      basePages,
      mainPages,
      draftPages,
    )
    expect(resolved.unresolved).toEqual([])
    expect(resolved.pages.map(({ id }) => id)).toEqual(['home', 'about', 'pricing'])
    expect(resolved.pages[0].name).toBe('Draft home')
  })
})
