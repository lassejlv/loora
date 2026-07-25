import type { CanvasElement, CanvasPage } from './canvas'

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

export type PageMergeConflict = {
  id: `page:${string}`
  kind: 'page'
  pageId: string
  base: CanvasPage | null
  main: CanvasPage | null
  draft: CanvasPage | null
}

export type PageOrderMergeConflict = {
  id: 'page-order'
  kind: 'page-order'
  mainOrder: string[]
  draftOrder: string[]
}

export type CanvasMergeConflict =
  | ElementMergeConflict
  | OrderMergeConflict
  | PageMergeConflict
  | PageOrderMergeConflict

export interface CanvasDiffSummary {
  added: number
  removed: number
  changed: number
}

export interface CanvasMergeResult {
  shapes: CanvasElement[]
  pages: CanvasPage[]
  conflicts: CanvasMergeConflict[]
  unresolved: string[]
  summary: CanvasDiffSummary
}

type Identified = { id: string }

function same<T>(left: T | undefined, right: T | undefined) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function collectionDiff<T extends Identified>(base: T[], next: T[]): CanvasDiffSummary {
  const baseById = new Map(base.map((item) => [item.id, item]))
  const nextIds = new Set(next.map((item) => item.id))
  let added = 0
  let changed = 0

  for (const item of next) {
    const previous = baseById.get(item.id)
    if (!previous) added += 1
    else if (!same(previous, item)) changed += 1
  }

  return {
    added,
    removed: base.filter((item) => !nextIds.has(item.id)).length,
    changed,
  }
}

export function canvasDiff(base: CanvasElement[], next: CanvasElement[]): CanvasDiffSummary {
  return collectionDiff(base, next)
}

function sourceChanged<T>(base: T | undefined, source: T | undefined) {
  return !same(base, source)
}

function appendMissing(order: string[], source: string[], included: Set<string>) {
  for (const id of source) {
    if (!included.has(id) || order.includes(id)) continue
    order.push(id)
  }
}

function mergeOrder<T extends Identified>(
  base: T[],
  main: T[],
  draft: T[],
  included: Set<string>,
  resolution: MergeChoice | undefined,
  conflictId: 'order' | 'page-order' = 'order',
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
          id: conflictId,
          kind: conflictId,
          mainOrder: mainIds,
          draftOrder: draftIds,
        } as OrderMergeConflict | PageOrderMergeConflict)
      : null,
  }
}

function mergePages(
  base: CanvasPage[],
  main: CanvasPage[],
  draft: CanvasPage[],
  resolutions: Readonly<Record<string, MergeChoice>>,
) {
  const baseById = new Map(base.map((page) => [page.id, page]))
  const mainById = new Map(main.map((page) => [page.id, page]))
  const draftById = new Map(draft.map((page) => [page.id, page]))
  const ids = new Set([...baseById.keys(), ...mainById.keys(), ...draftById.keys()])
  const selected = new Map<string, CanvasPage>()
  const conflicts: CanvasMergeConflict[] = []
  const unresolved: string[] = []

  for (const id of ids) {
    const basePage = baseById.get(id)
    const mainPage = mainById.get(id)
    const draftPage = draftById.get(id)
    const mainChanged = JSON.stringify(basePage) !== JSON.stringify(mainPage)
    const draftChanged = JSON.stringify(basePage) !== JSON.stringify(draftPage)
    let result: CanvasPage | undefined

    if (!mainChanged && !draftChanged) result = basePage
    else if (mainChanged && !draftChanged) result = mainPage
    else if (!mainChanged && draftChanged) result = draftPage
    else if (JSON.stringify(mainPage) === JSON.stringify(draftPage)) result = mainPage
    else {
      const conflictId = `page:${id}` as const
      const choice = resolutions[conflictId]
      conflicts.push({
        id: conflictId,
        kind: 'page',
        pageId: id,
        base: basePage ?? null,
        main: mainPage ?? null,
        draft: draftPage ?? null,
      })
      if (!choice) unresolved.push(conflictId)
      result = choice === 'draft' ? draftPage : mainPage
    }

    if (result) selected.set(id, result)
  }

  const order = mergeOrder(
    base,
    main,
    draft,
    new Set(selected.keys()),
    resolutions['page-order'],
    'page-order',
  )
  if (order.conflict) {
    conflicts.push(order.conflict)
    if (!resolutions['page-order']) unresolved.push('page-order')
  }

  return {
    pages: order.order.map((id) => selected.get(id)).filter((page): page is CanvasPage => !!page),
    conflicts,
    unresolved,
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
  basePages: CanvasPage[] = [],
  mainPages: CanvasPage[] = [],
  draftPages: CanvasPage[] = [],
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

  const pageMerge = mergePages(basePages, mainPages, draftPages, resolutions)
  const shapeSummary = collectionDiff(base, draft)
  const pageSummary = collectionDiff(basePages, draftPages)

  return {
    shapes: order.order.map((id) => selected.get(id)).filter((shape): shape is CanvasElement => !!shape),
    pages: pageMerge.pages,
    conflicts: [...conflicts, ...pageMerge.conflicts],
    unresolved: [...unresolved, ...pageMerge.unresolved],
    summary: {
      added: shapeSummary.added + pageSummary.added,
      removed: shapeSummary.removed + pageSummary.removed,
      changed: shapeSummary.changed + pageSummary.changed,
    },
  }
}
