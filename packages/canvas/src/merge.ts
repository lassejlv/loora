import {
  type CanvasDocument,
  type CanvasNode,
  type DesignToken,
  type NodeId,
  assertDocument,
} from './model'

export type MergeSide = 'left' | 'right'

export interface CanvasMergeConflict {
  id: string
  scope: 'node' | 'token' | 'document'
  targetId: string
  path: string
  base: unknown
  left: unknown
  right: unknown
}

export interface CanvasMergeResult {
  document: CanvasDocument
  conflicts: CanvasMergeConflict[]
  unresolved: string[]
  summary: {
    added: number
    removed: number
    changed: number
  }
}

export type CanvasMergeResolutions = Readonly<Record<string, MergeSide>>

const missing = Symbol('missing')

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function conflictId(scope: CanvasMergeConflict['scope'], targetId: string, path: string) {
  return `${scope}:${targetId}:${path || '$'}`
}

function mergeValue(
  base: unknown,
  left: unknown,
  right: unknown,
  context: {
    scope: CanvasMergeConflict['scope']
    targetId: string
    path: string
    conflicts: CanvasMergeConflict[]
    unresolved: string[]
    resolutions: CanvasMergeResolutions
  },
): unknown {
  if (same(left, right)) return left
  if (same(base, left)) return right
  if (same(base, right)) return left

  if (isPlainObject(left) && isPlainObject(right) && (isPlainObject(base) || base === missing)) {
    const baseRecord = isPlainObject(base) ? base : {}
    const keys = new Set([...Object.keys(baseRecord), ...Object.keys(left), ...Object.keys(right)])
    const result: Record<string, unknown> = {}
    for (const key of keys) {
      const value = mergeValue(
        key in baseRecord ? baseRecord[key] : missing,
        key in left ? left[key] : missing,
        key in right ? right[key] : missing,
        { ...context, path: context.path ? `${context.path}.${key}` : key },
      )
      if (value !== missing) result[key] = value
    }
    return result
  }

  const id = conflictId(context.scope, context.targetId, context.path)
  const resolution = context.resolutions[id]
  context.conflicts.push({
    id,
    scope: context.scope,
    targetId: context.targetId,
    path: context.path,
    base: base === missing ? undefined : base,
    left: left === missing ? undefined : left,
    right: right === missing ? undefined : right,
  })
  if (!resolution) context.unresolved.push(id)
  return resolution === 'right' ? right : left
}

function mergeCollection<T extends CanvasNode | DesignToken>(
  scope: 'node' | 'token',
  base: Record<string, T>,
  left: Record<string, T>,
  right: Record<string, T>,
  conflicts: CanvasMergeConflict[],
  unresolved: string[],
  resolutions: CanvasMergeResolutions,
) {
  const result: Record<string, T> = {}
  const ids = new Set([...Object.keys(base), ...Object.keys(left), ...Object.keys(right)])
  for (const id of ids) {
    const value = mergeValue(
      id in base ? base[id] : missing,
      id in left ? left[id] : missing,
      id in right ? right[id] : missing,
      { scope, targetId: id, path: '', conflicts, unresolved, resolutions },
    )
    if (value !== missing) result[id] = value as T
  }
  return result
}

export function diffDocuments(base: CanvasDocument, next: CanvasDocument) {
  const baseIds = new Set(Object.keys(base.nodes))
  const nextIds = new Set(Object.keys(next.nodes))
  let changed = 0
  for (const id of nextIds) {
    if (baseIds.has(id) && !same(base.nodes[id], next.nodes[id])) changed += 1
  }
  return {
    added: [...nextIds].filter((id) => !baseIds.has(id)).length,
    removed: [...baseIds].filter((id) => !nextIds.has(id)).length,
    changed,
  }
}

export function mergeDocuments(
  base: CanvasDocument,
  left: CanvasDocument,
  right: CanvasDocument,
  resolutions: CanvasMergeResolutions = {},
): CanvasMergeResult {
  const conflicts: CanvasMergeConflict[] = []
  const unresolved: string[] = []
  const document: CanvasDocument = {
    ...left,
    name: mergeValue(base.name, left.name, right.name, {
      scope: 'document',
      targetId: base.id,
      path: 'name',
      conflicts,
      unresolved,
      resolutions,
    }) as string,
    breakpoints: mergeValue(base.breakpoints, left.breakpoints, right.breakpoints, {
      scope: 'document',
      targetId: base.id,
      path: 'breakpoints',
      conflicts,
      unresolved,
      resolutions,
    }) as CanvasDocument['breakpoints'],
    nodes: mergeCollection(
      'node',
      base.nodes,
      left.nodes,
      right.nodes,
      conflicts,
      unresolved,
      resolutions,
    ),
    tokens: mergeCollection(
      'token',
      base.tokens,
      left.tokens,
      right.tokens,
      conflicts,
      unresolved,
      resolutions,
    ),
    themes: mergeValue(base.themes, left.themes, right.themes, {
      scope: 'document',
      targetId: base.id,
      path: 'themes',
      conflicts,
      unresolved,
      resolutions,
    }) as CanvasDocument['themes'],
    activeThemeId: mergeValue(
      base.activeThemeId,
      left.activeThemeId,
      right.activeThemeId,
      {
        scope: 'document',
        targetId: base.id,
        path: 'activeThemeId',
        conflicts,
        unresolved,
        resolutions,
      },
    ) as string,
    metadata: {
      ...left.metadata,
      updatedAt: Date.now(),
    },
  }
  const animations = mergeValue(
    base.animations ?? missing,
    left.animations ?? missing,
    right.animations ?? missing,
    {
      scope: 'document',
      targetId: base.id,
      path: 'animations',
      conflicts,
      unresolved,
      resolutions,
    },
  ) as CanvasDocument['animations']
  if (animations !== (missing as unknown)) document.animations = animations
  assertDocument(document)
  return {
    document,
    conflicts,
    unresolved,
    summary: diffDocuments(base, right),
  }
}

export function changedNodeIds(base: CanvasDocument, next: CanvasDocument): NodeId[] {
  const ids = new Set([...Object.keys(base.nodes), ...Object.keys(next.nodes)])
  return [...ids].filter((id) => !same(base.nodes[id], next.nodes[id]))
}
