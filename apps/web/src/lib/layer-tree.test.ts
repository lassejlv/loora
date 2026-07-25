import { describe, expect, test } from 'bun:test'
import type { CanvasElement } from '#/lib/canvas'
import { interactiveElements, visibleElements } from '#/lib/canvas'
import {
  buildLayerRows,
  reorderRows,
  reorderWithinGroup,
  rowHidden,
  rowIds,
  rowLocked,
  rowMatches,
} from '#/lib/layer-tree'

const element = (over: Partial<CanvasElement> & { id: string }): CanvasElement => ({
  name: over.id,
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  code: '<div />',
  ...over,
})

// Canvas order is bottom-to-top; the rail shows top-most first.
const canvas = [
  element({ id: 'bottom', name: 'Bottom' }),
  element({ id: 'g1a', name: 'Logo', groupId: 'g1' }),
  element({ id: 'g1b', name: 'Nav', groupId: 'g1' }),
  element({ id: 'top', name: 'Top' }),
]

describe('buildLayerRows', () => {
  test('lists top-most first and folds a group into one row', () => {
    const rows = buildLayerRows(canvas)
    expect(rows.map((row) => (row.kind === 'group' ? `group:${row.groupId}` : row.element.id))).toEqual([
      'top',
      'group:g1',
      'bottom',
    ])
    expect(rowIds(rows[1]!)).toEqual(['g1b', 'g1a'])
  })

  test('a group holds the slot of its top-most member', () => {
    const rows = buildLayerRows([
      element({ id: 'a', groupId: 'g' }),
      element({ id: 'loner' }),
      element({ id: 'b', groupId: 'g' }),
    ])
    // 'b' is above 'loner', so the whole group sits above it.
    expect(rows.map((row) => (row.kind === 'group' ? 'group' : row.element.id))).toEqual([
      'group',
      'loner',
    ])
  })
})

describe('reorderRows', () => {
  test('moves a plain row and returns bottom-to-top ids', () => {
    const rows = buildLayerRows(canvas)
    expect(reorderRows(rows, 'element:top', 'element:bottom')).toEqual([
      'top',
      'bottom',
      'g1a',
      'g1b',
    ])
  })

  test('moves a group as one contiguous block', () => {
    const rows = buildLayerRows(canvas)
    // Group above 'top' — its members stay adjacent and keep their inner order.
    expect(reorderRows(rows, 'group:g1', 'element:top')).toEqual([
      'bottom',
      'top',
      'g1a',
      'g1b',
    ])
  })

  test('is a no-op for an unknown or self-referencing drag', () => {
    const rows = buildLayerRows(canvas)
    const unchanged = ['bottom', 'g1a', 'g1b', 'top']
    expect(reorderRows(rows, 'element:top', 'element:top')).toEqual(unchanged)
    expect(reorderRows(rows, 'element:ghost', 'element:top')).toEqual(unchanged)
  })
})

describe('reorderWithinGroup', () => {
  test('reorders one member and leaves the rest of the canvas alone', () => {
    const rows = buildLayerRows(canvas)
    expect(reorderWithinGroup(rows, 'g1', 'g1b', 'g1a')).toEqual([
      'bottom',
      'g1b',
      'g1a',
      'top',
    ])
  })
})

describe('row flags', () => {
  test('a group reads as hidden or locked only when every member is', () => {
    const partly = buildLayerRows([
      element({ id: 'a', groupId: 'g', hidden: true }),
      element({ id: 'b', groupId: 'g' }),
    ])[0]!
    expect(rowHidden(partly)).toBe(false)

    const fully = buildLayerRows([
      element({ id: 'a', groupId: 'g', hidden: true, locked: true }),
      element({ id: 'b', groupId: 'g', hidden: true, locked: true }),
    ])[0]!
    expect(rowHidden(fully)).toBe(true)
    expect(rowLocked(fully)).toBe(true)
  })
})

describe('rowMatches', () => {
  test('matches element names case-insensitively', () => {
    const [top] = buildLayerRows(canvas)
    expect(rowMatches(top!, 'TO')).toBe(true)
    expect(rowMatches(top!, 'footer')).toBe(false)
    expect(rowMatches(top!, '  ')).toBe(true)
  })

  test('a group matches when any member does', () => {
    const group = buildLayerRows(canvas)[1]!
    expect(rowMatches(group, 'nav')).toBe(true)
    expect(rowMatches(group, 'group of')).toBe(true)
    expect(rowMatches(group, 'footer')).toBe(false)
  })
})

describe('visibility helpers', () => {
  test('hidden leaves the scene; locked stays on screen but out of reach', () => {
    const elements = [
      element({ id: 'plain' }),
      element({ id: 'gone', hidden: true }),
      element({ id: 'pinned', locked: true }),
    ]
    expect(visibleElements(elements).map((el) => el.id)).toEqual(['plain', 'pinned'])
    expect(interactiveElements(elements).map((el) => el.id)).toEqual(['plain'])
  })
})
