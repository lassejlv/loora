import type { CanvasElement } from '#/lib/canvas'

/**
 * Rows for the layers rail.
 *
 * The canvas stores a flat, bottom-to-top array; grouping is just a shared
 * `groupId`. The rail shows top-most first (what you see on canvas is what's at
 * the top of the list) and folds each group into one collapsible parent row.
 * A group occupies the slot of its top-most member, so collapsing a group never
 * reorders what's around it.
 */

export interface LayerGroupRow {
  kind: 'group'
  groupId: string
  /** Members, top-most first. */
  members: CanvasElement[]
}

export interface LayerElementRow {
  kind: 'element'
  element: CanvasElement
}

export type LayerRow = LayerGroupRow | LayerElementRow

export function buildLayerRows(elements: CanvasElement[]): LayerRow[] {
  const topFirst = [...elements].reverse()
  const rows: LayerRow[] = []
  const groupRows = new Map<string, LayerGroupRow>()
  for (const element of topFirst) {
    if (!element.groupId) {
      rows.push({ kind: 'element', element })
      continue
    }
    const existing = groupRows.get(element.groupId)
    if (existing) {
      existing.members.push(element)
      continue
    }
    const row: LayerGroupRow = { kind: 'group', groupId: element.groupId, members: [element] }
    groupRows.set(element.groupId, row)
    rows.push(row)
  }
  return rows
}

export function rowIds(row: LayerRow): string[] {
  return row.kind === 'group' ? row.members.map((member) => member.id) : [row.element.id]
}

export function rowElements(row: LayerRow): CanvasElement[] {
  return row.kind === 'group' ? row.members : [row.element]
}

export function groupLabel(row: LayerGroupRow): string {
  return `Group of ${row.members.length}`
}

/** Case-insensitive name match; a group matches when any member does. */
export function rowMatches(row: LayerRow, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  if (row.kind === 'element') return matchesName(row.element, needle)
  return groupLabel(row).toLowerCase().includes(needle) || row.members.some((member) => matchesName(member, needle))
}

function matchesName(element: CanvasElement, needle: string) {
  return (element.name || 'Element').toLowerCase().includes(needle)
}

/**
 * Move one row above or below another and flatten back to the canvas's
 * bottom-to-top order. Groups travel as a contiguous block — Figma's behaviour,
 * and the only way a collapsed group can be dragged at all.
 */
export function reorderRows(rows: LayerRow[], dragKey: string, overKey: string): string[] {
  const from = rows.findIndex((row) => rowKey(row) === dragKey)
  const over = rows.findIndex((row) => rowKey(row) === overKey)
  if (from < 0 || over < 0 || from === over) return rows.flatMap(rowIds).reverse()
  const next = [...rows]
  const [moved] = next.splice(from, 1)
  next.splice(over, 0, moved!)
  // Rows are top-first; the canvas array is bottom-first.
  return next.flatMap(rowIds).reverse()
}

/** Reorder a single member inside its group, leaving every other row alone. */
export function reorderWithinGroup(
  rows: LayerRow[],
  groupId: string,
  dragId: string,
  overId: string,
): string[] {
  const next = rows.map((row) => {
    if (row.kind !== 'group' || row.groupId !== groupId) return row
    const ids = row.members.map((member) => member.id)
    const from = ids.indexOf(dragId)
    const over = ids.indexOf(overId)
    if (from < 0 || over < 0 || from === over) return row
    const members = [...row.members]
    const [moved] = members.splice(from, 1)
    members.splice(over, 0, moved!)
    return { ...row, members }
  })
  return next.flatMap(rowIds).reverse()
}

export function rowKey(row: LayerRow): string {
  return row.kind === 'group' ? `group:${row.groupId}` : `element:${row.element.id}`
}

/** A group reads as hidden/locked only when every member is. */
export function rowHidden(row: LayerRow): boolean {
  return rowElements(row).every((element) => element.hidden === true)
}

export function rowLocked(row: LayerRow): boolean {
  return rowElements(row).every((element) => element.locked === true)
}
