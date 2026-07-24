import { describe, expect, test } from 'bun:test'
import type { CanvasElement } from './canvas'
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
})
