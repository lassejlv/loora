// The canvas model: every element is a positioned box of code. The code is
// plain HTML/CSS/JS or JSX defining App — rendered live in a sandboxed
// iframe with React and Tailwind available (see element-frame.tsx).
export interface CanvasElement {
  id: string
  name: string
  x: number
  y: number
  w: number
  h: number
  code: string
  groupId?: string // elements sharing a groupId select and move as one
}

export interface ElementActions {
  createElement: (el: Omit<CanvasElement, 'id'> & { id?: string }) => CanvasElement
  createElements: (els: Omit<CanvasElement, 'id'>[]) => CanvasElement[]
  updateElement: (id: string, patch: Partial<Omit<CanvasElement, 'id'>>) => CanvasElement | null
  deleteElement: (id: string) => boolean
}

let counter = 0
export function elementId() {
  counter += 1
  return `e${Date.now().toString(36)}${counter}`
}

// Loaded documents may contain records from the pre-code element era (typed
// shapes without a code field); those are dropped rather than migrated.
export function onlyCodeElements(list: unknown): CanvasElement[] {
  if (!Array.isArray(list)) return []
  return list.filter(
    (el): el is CanvasElement =>
      !!el &&
      typeof el === 'object' &&
      typeof (el as CanvasElement).id === 'string' &&
      typeof (el as CanvasElement).code === 'string' &&
      typeof (el as CanvasElement).x === 'number' &&
      typeof (el as CanvasElement).y === 'number' &&
      typeof (el as CanvasElement).w === 'number' &&
      typeof (el as CanvasElement).h === 'number',
  )
}
