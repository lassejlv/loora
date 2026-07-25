// The persisted canvas model: every element is a positioned box of code. The
// code is plain HTML/CSS/JS or JSX defining App — rendered live in a sandboxed
// iframe with React and Tailwind available (see apps/web element-frame.tsx).
// Lives in @loora/db because design rows persist `CanvasElement[]` as JSONB;
// the canvas helpers built on top of it stay in apps/web (src/lib/canvas.ts).
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
