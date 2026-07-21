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
  // Returns the resulting bottom-to-top id order.
  reorderElements: (orderedIds: string[]) => string[]
  // Assigns a fresh shared groupId; null when fewer than 2 of the ids exist.
  groupElements: (ids: string[]) => { groupId: string; ids: string[] } | null
  // Clears groupId on the given ids; returns how many were actually grouped.
  ungroupElements: (ids: string[]) => number
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

export type CodeEditResult =
  | { ok: true; code: string; contexts: string[] }
  | { ok: false; error: string }

// The replaced range plus ~2 lines either side, so the agent can confirm an
// edit landed where intended without a readElement round-trip.
function editContext(code: string, start: number, end: number): string {
  let from = start
  for (let i = 0; i < 3; i++) {
    const nl = code.lastIndexOf('\n', from - 1)
    if (nl === -1) {
      from = 0
      break
    }
    from = nl
  }
  if (from !== 0) from += 1
  let to = end - 1
  for (let i = 0; i < 3; i++) {
    const nl = code.indexOf('\n', to + 1)
    if (nl === -1) {
      to = code.length
      break
    }
    to = nl
  }
  const snippet = code.slice(from, to)
  return snippet.length > 400 ? `${snippet.slice(0, 400)}…` : snippet
}

// Exact search/replace over an element's code, applied in order and atomically:
// the first failing edit aborts the whole batch so the agent never lands a
// half-applied change. String replacement is done with indexOf/slice (not
// String.replace) so `$&`-style patterns in newCode stay literal.
export function applyCodeEdits(code: string, edits: readonly CodeEdit[]): CodeEditResult {
  let next = code
  const contexts: string[] = []
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
      const firstAt = next.indexOf(edit.oldCode)
      next = next.split(edit.oldCode).join(edit.newCode)
      // Text before the first occurrence is unchanged, so firstAt still points
      // at the first replacement in the new string.
      contexts.push(
        `${count}× ${editContext(next, firstAt, firstAt + edit.newCode.length)}`,
      )
    } else {
      const at = next.indexOf(edit.oldCode)
      next = next.slice(0, at) + edit.newCode + next.slice(at + edit.oldCode.length)
      contexts.push(editContext(next, at, at + edit.newCode.length))
    }
  }
  return { ok: true, code: next, contexts }
}

// An inline text edit from a live frame: the text node's content before and
// after the user typed. Mapped onto source code with exact search/replace;
// the trimmed retry covers JSX collapsing edge whitespace out of the DOM.
export interface TextEdit {
  before: string
  after: string
}

export function applyTextEdits(code: string, edits: readonly TextEdit[]): CodeEditResult {
  let result = applyCodeEdits(
    code,
    edits.map((e) => ({ oldCode: e.before, newCode: e.after })),
  )
  if (!result.ok) {
    const trimmed = edits
      .filter((e) => e.before.trim().length > 0)
      .map((e) => ({ oldCode: e.before.trim(), newCode: e.after.trim() }))
    if (trimmed.length > 0) result = applyCodeEdits(code, trimmed)
  }
  return result
}

// Swap an image source everywhere it appears in the code. replaceAll on
// purpose: the same src string in several places is the same image (a logo,
// a repeated card art) and clicking one instance cannot disambiguate anyway.
export function replaceImageSource(
  code: string,
  oldSrc: string,
  newSrc: string,
): CodeEditResult {
  if (!oldSrc) return { ok: false, error: 'The image has no src to replace' }
  return applyCodeEdits(code, [{ oldCode: oldSrc, newCode: newSrc, replaceAll: true }])
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
