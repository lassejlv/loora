// The canvas model: every element is a positioned box of code, rendered live
// in a sandboxed iframe (see element-frame.tsx). The element shape itself
// lives in @loora/db — it is the persisted JSONB schema — and is re-exported
// here so app code keeps importing it from #/lib/canvas.
import type { CanvasElement } from '@loora/db/canvas'

export type { CanvasElement }

export interface ElementActions {
  createElement: (el: Omit<CanvasElement, 'id'> & { id?: string }) => CanvasElement
  createElements: (els: Omit<CanvasElement, 'id'>[]) => CanvasElement[]
  updateElement: (id: string, patch: Partial<Omit<CanvasElement, 'id'>>) => CanvasElement | null
  deleteElement: (id: string) => boolean
}

export type ElementPatch = Partial<Omit<CanvasElement, 'id'>>

export function applyElementPatches(
  elements: CanvasElement[],
  patches: ReadonlyMap<string, ElementPatch>,
): CanvasElement[] {
  if (patches.size === 0) return elements
  return elements.map((element) => {
    const patch = patches.get(element.id)
    return patch ? { ...element, ...patch } : element
  })
}

// Rebuild z-order in one pass. Unknown and duplicate ids are ignored, while
// elements omitted by the caller keep their existing relative order at the end.
export function reorderElements(elements: CanvasElement[], orderedIds: string[]): CanvasElement[] {
  const byId = new Map(elements.map((element) => [element.id, element]))
  const seen = new Set<string>()
  const ordered: CanvasElement[] = []

  for (const id of orderedIds) {
    if (seen.has(id)) continue
    const element = byId.get(id)
    if (!element) continue
    seen.add(id)
    ordered.push(element)
  }
  for (const element of elements) {
    if (!seen.has(element.id)) ordered.push(element)
  }
  return ordered
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
