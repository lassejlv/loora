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
}
