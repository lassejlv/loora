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

export interface CodeEdit {
  oldCode: string
  newCode: string
  replaceAll?: boolean
}

export type CodeEditResult = { ok: true; code: string } | { ok: false; error: string }

// Exact search/replace over an element's code, applied in order and atomically:
// the first failing edit aborts the whole batch so the agent never lands a
// half-applied change. String replacement is done with indexOf/slice (not
// String.replace) so `$&`-style patterns in newCode stay literal.
export function applyCodeEdits(code: string, edits: readonly CodeEdit[]): CodeEditResult {
  let next = code
  for (const [index, edit] of edits.entries()) {
    const label = edits.length > 1 ? `edit ${index + 1}: ` : ''
    if (edit.oldCode.length === 0) {
      return { ok: false, error: `${label}oldCode is empty — provide the exact code to replace` }
    }
    const count = next.split(edit.oldCode).length - 1
    if (count === 0) {
      return {
        ok: false,
        error: `${label}oldCode was not found in the element's current code — call readElement and retry with an exact substring`,
      }
    }
    if (count > 1 && !edit.replaceAll) {
      return {
        ok: false,
        error: `${label}oldCode matches ${count} places — include more surrounding code to make it unique, or set replaceAll`,
      }
    }
    if (edit.replaceAll) {
      next = next.split(edit.oldCode).join(edit.newCode)
    } else {
      const at = next.indexOf(edit.oldCode)
      next = next.slice(0, at) + edit.newCode + next.slice(at + edit.oldCode.length)
    }
  }
  return { ok: true, code: next }
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
