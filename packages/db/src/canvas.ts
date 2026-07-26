// Legacy V1 persisted canvas data. It remains readable only for first-open
// migration, rollback, and expiring-link compatibility. Writable editor code
// uses CanvasDocumentV2 from @loora/canvas.
export interface CanvasElement {
  id: string
  name: string
  x: number
  y: number
  w: number
  h: number
  code: string
  r?: number // rotation in degrees, clockwise about the element center; absent = 0
  groupId?: string // elements sharing a groupId select and move as one
  hidden?: boolean // not rendered, not snapshotted, not exported; absent = visible
  locked?: boolean // not selectable or movable on the canvas; absent = editable
}

// A Page is a non-destructive composition of reusable canvas elements. Page
// items have their own identity because one element may be rendered more than
// once (or on several pages) without sharing iframe/capture state.
export interface CanvasPageItem {
  id: string
  elementId: string
  height: number
}

export interface CanvasPage {
  id: string
  name: string
  x: number
  y: number
  w: number
  items: CanvasPageItem[]
}

/**
 * Older writes stored `shapes`/`pages` as a JSON *string* inside the jsonb
 * column instead of a jsonb array, so a row reads back as `"[{…}]"` rather
 * than `[{…}]`. Production is mostly in that state, and iterating a string
 * yields characters — which crashed first-open migration for those designs.
 * Read every legacy array through this.
 */
export function legacyArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? (parsed as T[]) : []
    } catch {
      return []
    }
  }
  return []
}
