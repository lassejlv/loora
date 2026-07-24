import type { CanvasElement } from './canvas'

export const DRAFT_STATUSES = ['active', 'proposed', 'applied', 'closed'] as const

export type DraftStatus = (typeof DRAFT_STATUSES)[number]

export interface CanvasTarget {
  designId: string
  draftId: string | null
}

export type MergeChoice = 'main' | 'draft'

export type ElementMergeConflict = {
  id: `element:${string}`
  kind: 'element'
  elementId: string
  base: CanvasElement | null
  main: CanvasElement | null
  draft: CanvasElement | null
}

export type OrderMergeConflict = {
  id: 'order'
  kind: 'order'
  mainOrder: string[]
  draftOrder: string[]
}

export type CanvasMergeConflict = ElementMergeConflict | OrderMergeConflict

export interface CanvasDiffSummary {
  added: number
  removed: number
  changed: number
}

export interface CanvasMergeResult {
  shapes: CanvasElement[]
  conflicts: CanvasMergeConflict[]
  unresolved: string[]
  summary: CanvasDiffSummary
}

function same(left: CanvasElement | undefined, right: CanvasElement | undefined) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function canvasDiff(base: CanvasElement[], next: CanvasElement[]): CanvasDiffSummary {
  const baseById = new Map(base.map((shape) => [shape.id, shape]))
  const nextIds = new Set(next.map((shape) => shape.id))
  let added = 0
  let changed = 0

  for (const shape of next) {
    const previous = baseById.get(shape.id)
    if (!previous) added += 1
    else if (!same(previous, shape)) changed += 1
  }

  return {
    added,
    removed: base.filter((shape) => !nextIds.has(shape.id)).length,
    changed,
  }
}

function sourceChanged(
  base: CanvasElement | undefined,
  source: CanvasElement | undefined,
) {
  return !same(base, source)
}

function appendMissing(order: string[], source: string[], included: Set<string>) {
  for (const id of source) {
    if (!included.has(id) || order.includes(id)) continue
    order.push(id)
  }
}

function mergeOrder(
  base: CanvasElement[],
  main: CanvasElement[],
  draft: CanvasElement[],
  included: Set<string>,
  resolution: MergeChoice | undefined,
) {
  const baseIds = base.map((shape) => shape.id).filter((id) => included.has(id))
  const baseIdSet = new Set(baseIds)
  const mainIds = main.map((shape) => shape.id).filter((id) => included.has(id))
  const draftIds = draft.map((shape) => shape.id).filter((id) => included.has(id))
  const mainBaseOrder = mainIds.filter((id) => baseIdSet.has(id))
  const draftBaseOrder = draftIds.filter((id) => baseIdSet.has(id))
  const mainChanged = JSON.stringify(mainBaseOrder) !== JSON.stringify(baseIds)
  const draftChanged = JSON.stringify(draftBaseOrder) !== JSON.stringify(baseIds)
  const conflict =
    mainChanged &&
    draftChanged &&
    JSON.stringify(mainBaseOrder) !== JSON.stringify(draftBaseOrder)

  let primary: string[]
  if (conflict) primary = resolution === 'draft' ? draftIds : mainIds
  else if (draftChanged) primary = draftIds
  else if (mainChanged) primary = mainIds
  else primary = baseIds

  const order = primary.filter((id, index) => included.has(id) && primary.indexOf(id) === index)
  appendMissing(order, mainIds, included)
  appendMissing(order, draftIds, included)

  return {
    order,
    conflict: conflict
      ? ({
          id: 'order',
          kind: 'order',
          mainOrder: mainIds,
          draftOrder: draftIds,
        } satisfies OrderMergeConflict)
      : null,
  }
}

/**
 * Merge a draft against the Main snapshot it started from.
 *
 * Unresolved element conflicts temporarily prefer Main in `shapes`, making the
 * result safe to preview. Callers must require `unresolved.length === 0`
 * before persisting an apply.
 */
export function mergeCanvas(
  base: CanvasElement[],
  main: CanvasElement[],
  draft: CanvasElement[],
  resolutions: Readonly<Record<string, MergeChoice>> = {},
): CanvasMergeResult {
  const baseById = new Map(base.map((shape) => [shape.id, shape]))
  const mainById = new Map(main.map((shape) => [shape.id, shape]))
  const draftById = new Map(draft.map((shape) => [shape.id, shape]))
  const ids = new Set([...baseById.keys(), ...mainById.keys(), ...draftById.keys()])
  const selected = new Map<string, CanvasElement>()
  const conflicts: CanvasMergeConflict[] = []
  const unresolved: string[] = []

  for (const id of ids) {
    const baseShape = baseById.get(id)
    const mainShape = mainById.get(id)
    const draftShape = draftById.get(id)
    const mainChanged = sourceChanged(baseShape, mainShape)
    const draftChanged = sourceChanged(baseShape, draftShape)
    let result: CanvasElement | undefined

    if (!mainChanged && !draftChanged) result = baseShape
    else if (mainChanged && !draftChanged) result = mainShape
    else if (!mainChanged && draftChanged) result = draftShape
    else if (same(mainShape, draftShape)) result = mainShape
    else {
      const conflictId = `element:${id}` as const
      const choice = resolutions[conflictId]
      conflicts.push({
        id: conflictId,
        kind: 'element',
        elementId: id,
        base: baseShape ?? null,
        main: mainShape ?? null,
        draft: draftShape ?? null,
      })
      if (!choice) unresolved.push(conflictId)
      result = choice === 'draft' ? draftShape : mainShape
    }

    if (result) selected.set(id, result)
  }

  const order = mergeOrder(base, main, draft, new Set(selected.keys()), resolutions.order)
  if (order.conflict) {
    conflicts.push(order.conflict)
    if (!resolutions.order) unresolved.push('order')
  }

  return {
    shapes: order.order.map((id) => selected.get(id)).filter((shape): shape is CanvasElement => !!shape),
    conflicts,
    unresolved,
    summary: canvasDiff(base, draft),
  }
}
