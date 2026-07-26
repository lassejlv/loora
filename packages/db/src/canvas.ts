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
