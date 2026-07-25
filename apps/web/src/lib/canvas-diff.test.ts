import { describe, expect, test } from 'bun:test'
import type { CanvasElement } from '#/lib/canvas'
import { diffCanvas, guessLang } from '#/lib/canvas-diff'

const element = (over: Partial<CanvasElement> & { id: string }): CanvasElement => ({
  name: 'Card',
  x: 0,
  y: 0,
  w: 200,
  h: 120,
  code: '<div>hi</div>',
  ...over,
})

describe('guessLang', () => {
  test('reads App definitions and JSX markup as tsx', () => {
    expect(guessLang('function App() { return <div /> }')).toBe('tsx')
    expect(guessLang('<div className="p-4">hi</div>')).toBe('tsx')
    expect(guessLang('<Card />')).toBe('tsx')
  })

  test('reads plain markup as html', () => {
    expect(guessLang('<div class="p-4">hi</div>')).toBe('html')
    expect(guessLang('<!doctype html><html></html>')).toBe('html')
  })
})

describe('diffCanvas', () => {
  test('reports added, removed and code-changed elements', () => {
    const diff = diffCanvas(
      [element({ id: 'a' }), element({ id: 'b' })],
      [element({ id: 'a', code: '<div>bye</div>' }), element({ id: 'c' })],
    )
    expect({ added: diff.added, removed: diff.removed, changed: diff.changed }).toEqual({
      added: 1,
      removed: 1,
      changed: 1,
    })
    expect(diff.changes.map((change) => [change.id, change.kind])).toEqual([
      ['a', 'changed'],
      ['c', 'added'],
      ['b', 'removed'],
    ])
    expect(diff.changes[0]?.codeChanged).toBe(true)
  })

  test('describes geometry-only edits in prose without a code hunk', () => {
    const diff = diffCanvas(
      [element({ id: 'a' })],
      [element({ id: 'a', x: 24, y: -8, w: 300, r: 15 })],
    )
    const change = diff.changes[0]
    expect(change?.codeChanged).toBe(false)
    expect(change?.geometry).toBe('Moved x +24px, y −8px · resized 200×120 → 300×120 · rotated 0° → 15°')
  })

  test('ignores untouched elements', () => {
    const diff = diffCanvas([element({ id: 'a' })], [element({ id: 'a' })])
    expect(diff.changes).toEqual([])
    expect(diff.orderChanged).toBe(false)
  })

  test('flags a pure z-order change no element hunk would show', () => {
    const diff = diffCanvas(
      [element({ id: 'a' }), element({ id: 'b' })],
      [element({ id: 'b' }), element({ id: 'a' })],
    )
    expect(diff.changes).toEqual([])
    expect(diff.orderChanged).toBe(true)
  })

  test('reports renames and grouping', () => {
    const diff = diffCanvas(
      [element({ id: 'a' })],
      [element({ id: 'a', name: 'Hero', groupId: 'g1' })],
    )
    expect(diff.changes[0]?.geometry).toBe('Renamed “Card” → “Hero” · grouped')
  })
})
