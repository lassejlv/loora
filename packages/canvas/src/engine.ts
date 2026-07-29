import {
  assertDocument,
  type CanvasDocument,
  type CanvasNode,
  type CanvasStyle,
  type CanvasLayout,
  type CanvasRuntimeSchema,
  type DesignToken,
  type NodeId,
  type NodeMutationPatch,
  type NodePatch,
  orderedChildren,
  DEFAULT_ORDER_STEP,
  MIN_ORDER_GAP,
  validateCommonNodeMutationPatch,
} from './model'

export interface CanvasFieldPrecondition {
  scope: 'node' | 'token'
  id: string
  path: string
  hash: string
}

export type CanvasOperation =
  | { type: 'node.insert'; node: CanvasNode }
  | {
      type: 'node.patch'
      id: NodeId
      patch: NodeMutationPatch
      replace?: (keyof NodeMutationPatch)[]
      unset?: (keyof NodeMutationPatch)[]
    }
  | { type: 'node.move'; id: NodeId; parentId: NodeId | null; order: number }
  | { type: 'node.delete'; id: NodeId }
  | {
      type: 'instance.patchOverride'
      id: NodeId
      targetId: NodeId
      patch: NodePatch | null
      replace?: boolean
    }
  | { type: 'token.upsert'; token: DesignToken }
  | { type: 'token.delete'; id: string }

export interface CanvasTransaction {
  id: string
  label: string
  operations: CanvasOperation[]
  preconditions?: CanvasFieldPrecondition[]
  createdAt?: number
  coalesceKey?: string
  documentUpdatedAt?: number
}

const operationTypes = new Set<CanvasOperation['type']>([
  'node.insert',
  'node.patch',
  'node.move',
  'node.delete',
  'instance.patchOverride',
  'token.upsert',
  'token.delete',
])

const operationKeys: Record<CanvasOperation['type'], Set<string>> = {
  'node.insert': new Set(['type', 'node']),
  'node.patch': new Set(['type', 'id', 'patch', 'replace', 'unset']),
  'node.move': new Set(['type', 'id', 'parentId', 'order']),
  'node.delete': new Set(['type', 'id']),
  'instance.patchOverride': new Set([
    'type',
    'id',
    'targetId',
    'patch',
    'replace',
  ]),
  'token.upsert': new Set(['type', 'token']),
  'token.delete': new Set(['type', 'id']),
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function serializable(value: unknown, active = new Set<unknown>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || active.has(value)) return false
  active.add(value)
  if (Array.isArray(value)) {
    const valid = value.every((item) => serializable(item, active))
    active.delete(value)
    return valid
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return false
  const valid = Object.values(value as Record<string, unknown>).every(
    (item) => item !== undefined && serializable(item, active),
  )
  active.delete(value)
  return valid
}

const mutationPatchKeys = new Set<keyof NodeMutationPatch>([
  'name',
  'hidden',
  'locked',
  'rotation',
  'layout',
  'style',
  'semanticTag',
  'text',
  'runs',
  'src',
  'alt',
  'interactions',
  'variant',
  'order',
  'viewport',
  'variants',
  'defaultVariant',
  'variantOverrides',
  'shape',
  'viewBox',
  'paths',
  'fit',
  'componentId',
  'overrides',
  'responsive',
  'metadata',
])

function validPatchKeyList(value: unknown) {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= mutationPatchKeys.size &&
      value.every(
        (key) => typeof key === 'string' && mutationPatchKeys.has(key as keyof NodeMutationPatch),
      ))
  )
}

export function parseCanvasTransaction(value: unknown): CanvasTransaction {
  if (!record(value)) throw new Error('Canvas transaction must be an object')
  if (
    Object.keys(value).some(
      (key) =>
        ![
          'id',
          'label',
          'operations',
          'preconditions',
          'createdAt',
          'coalesceKey',
          'documentUpdatedAt',
        ].includes(key),
    )
  ) {
    throw new Error('Canvas transaction contains unknown fields')
  }
  if (typeof value.id !== 'string' || !value.id || value.id.length > 200) {
    throw new Error('Canvas transaction id is invalid')
  }
  if (typeof value.label !== 'string' || !value.label || value.label.length > 200) {
    throw new Error('Canvas transaction label is invalid')
  }
  if (
    !Array.isArray(value.operations) ||
    value.operations.length === 0 ||
    value.operations.length > 2_000
  ) {
    throw new Error('Canvas transaction operations are invalid')
  }
  if (!serializable(value)) throw new Error('Canvas transaction must be finite and serializable')
  if (
    (value.createdAt !== undefined && !Number.isFinite(value.createdAt)) ||
    (value.documentUpdatedAt !== undefined && !Number.isFinite(value.documentUpdatedAt)) ||
    (value.coalesceKey !== undefined &&
      (typeof value.coalesceKey !== 'string' || value.coalesceKey.length > 200))
  ) {
    throw new Error('Canvas transaction metadata is invalid')
  }
  for (const [index, operation] of value.operations.entries()) {
    if (
      !record(operation) ||
      typeof operation.type !== 'string' ||
      !operationTypes.has(operation.type as CanvasOperation['type'])
    ) {
      throw new Error(`Canvas operation ${index} is invalid`)
    }
    if (
      Object.keys(operation).some(
        (key) =>
          !operationKeys[operation.type as CanvasOperation['type']].has(key),
      )
    ) {
      throw new Error(`Canvas operation ${index} contains unknown fields`)
    }
    if (
      operation.type === 'node.move' &&
      (!Number.isFinite(operation.order) ||
        (operation.parentId !== null && typeof operation.parentId !== 'string'))
    ) {
      throw new Error(`Canvas move operation ${index} is invalid`)
    }
    if (
      operation.type === 'node.patch' &&
      (!validPatchKeyList(operation.replace) ||
        !validPatchKeyList(operation.unset))
    ) {
      throw new Error(`Canvas patch operation ${index} has invalid field lists`)
    }
    if (
      (operation.type === 'node.patch' ||
        operation.type === 'node.delete' ||
        operation.type === 'instance.patchOverride') &&
      typeof operation.id !== 'string'
    ) {
      throw new Error(`Canvas operation ${index} has no target id`)
    }
    if (operation.type === 'node.insert' && !record(operation.node)) {
      throw new Error(`Canvas insert operation ${index} has no node`)
    }
    if (operation.type === 'node.patch' && !record(operation.patch)) {
      throw new Error(`Canvas patch operation ${index} has no patch`)
    }
    if (
      operation.type === 'instance.patchOverride' &&
      (typeof operation.targetId !== 'string' ||
        (operation.patch !== null && !record(operation.patch)))
    ) {
      throw new Error(`Canvas instance override operation ${index} is invalid`)
    }
    if (operation.type === 'token.upsert' && !record(operation.token)) {
      throw new Error(`Canvas token operation ${index} has no token`)
    }
    if (operation.type === 'token.delete' && typeof operation.id !== 'string') {
      throw new Error(`Canvas token operation ${index} has no token id`)
    }
  }
  if (value.preconditions !== undefined) {
    if (
      !Array.isArray(value.preconditions) ||
      value.preconditions.length > 10_000 ||
      value.preconditions.some(
        (precondition) =>
          !record(precondition) ||
          Object.keys(precondition).some(
            (key) => !['scope', 'id', 'path', 'hash'].includes(key),
          ) ||
          !['node', 'token'].includes(String(precondition.scope)) ||
          typeof precondition.id !== 'string' ||
          precondition.id.length === 0 ||
          precondition.id.length > 200 ||
          typeof precondition.path !== 'string' ||
          precondition.path.length > 1_000 ||
          (precondition.path !== '' &&
            !/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(
              precondition.path,
            )) ||
          typeof precondition.hash !== 'string' ||
          !/^[a-z0-9]+$/.test(precondition.hash),
      )
    ) {
      throw new Error('Canvas transaction preconditions are invalid')
    }
  }
  return structuredClone(value) as unknown as CanvasTransaction
}

export const canvasTransactionSchema: CanvasRuntimeSchema<CanvasTransaction> = {
  parse: parseCanvasTransaction,
  safeParse(value) {
    try {
      return { success: true, data: parseCanvasTransaction(value) }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error('Invalid Canvas transaction'),
      }
    }
  },
}

export interface CanvasApplyResult {
  document: CanvasDocument
  inverse: CanvasTransaction
  changedNodeIds: Set<NodeId>
  changedTokenIds: Set<string>
  idempotent: boolean
}

export interface CanvasHistoryResult extends CanvasApplyResult {
  transaction: CanvasTransaction
}

export interface CanvasTransactionConflict {
  transactionId: string
  precondition: CanvasFieldPrecondition
  actualHash: string
}

export type CanvasRebaseResult =
  | { ok: true; document: CanvasDocument; transactions: CanvasTransaction[] }
  | { ok: false; document: CanvasDocument; conflicts: CanvasTransactionConflict[] }

function clone<T>(value: T): T {
  return structuredClone(value)
}

function stable(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
    .join(',')}}`
}

export function valueHash(value: unknown) {
  const input = stable(value)
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function valueAtPath(value: unknown, path: string) {
  if (!path) return value
  let current = value
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

export function preconditionsForNodePatch(
  document: CanvasDocument,
  id: NodeId,
  patch: NodeMutationPatch,
): CanvasFieldPrecondition[] {
  const node = document.nodes[id]
  if (!node) return []
  const paths: string[] = []
  const visit = (value: unknown, path: string) => {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      const entries = Object.entries(value as Record<string, unknown>)
      if (entries.length > 0) {
        for (const [key, child] of entries) {
          visit(child, path ? `${path}.${key}` : key)
        }
        return
      }
    }
    paths.push(path)
  }
  for (const [key, value] of Object.entries(patch)) visit(value, key)
  return paths.map((path) => ({
    scope: 'node',
    id,
    path,
    hash: valueHash(valueAtPath(node, path)),
  }))
}

export function preconditionsForNodeMove(
  document: CanvasDocument,
  id: NodeId,
): CanvasFieldPrecondition[] {
  const node = document.nodes[id]
  if (!node) return []
  return [
    {
      scope: 'node',
      id,
      path: 'parentId',
      hash: valueHash(node.parentId),
    },
    {
      scope: 'node',
      id,
      path: 'order',
      hash: valueHash(node.order),
    },
  ]
}

export function withTransactionPreconditions(
  document: CanvasDocument,
  transaction: CanvasTransaction,
): CanvasTransaction {
  if (transaction.preconditions !== undefined) return transaction
  const preconditions: CanvasFieldPrecondition[] = []
  for (const operation of transaction.operations) {
    if (operation.type === 'node.insert') {
      preconditions.push({
        scope: 'node',
        id: operation.node.id,
        path: '',
        hash: valueHash(document.nodes[operation.node.id]),
      })
      continue
    }
    if (operation.type === 'node.patch') {
      preconditions.push(
        ...preconditionsForNodePatch(
          document,
          operation.id,
          operation.patch,
        ),
      )
      continue
    }
    if (operation.type === 'node.move') {
      preconditions.push(
        ...preconditionsForNodeMove(document, operation.id),
      )
      continue
    }
    if (operation.type === 'node.delete') {
      for (const node of descendants(document, operation.id)) {
        preconditions.push({
          scope: 'node',
          id: node.id,
          path: '',
          hash: valueHash(node),
        })
      }
      continue
    }
    if (operation.type === 'instance.patchOverride') {
      const instance = document.nodes[operation.id]
      preconditions.push({
        scope: 'node',
        id: operation.id,
        path: 'overrides',
        hash: valueHash(instance?.type === 'instance'
          ? instance.overrides
          : undefined),
      })
      continue
    }
    const id =
      operation.type === 'token.upsert'
        ? operation.token.id
        : operation.id
    preconditions.push({
      scope: 'token',
      id,
      path: '',
      hash: valueHash(document.tokens[id]),
    })
  }
  const unique = new Map(
    preconditions.map((precondition) => [
      `${precondition.scope}:${precondition.id}:${precondition.path}`,
      precondition,
    ]),
  )
  return {
    ...transaction,
    preconditions: [...unique.values()],
  }
}

function verifyPreconditions(
  document: CanvasDocument,
  transaction: CanvasTransaction,
): CanvasTransactionConflict[] {
  const conflicts: CanvasTransactionConflict[] = []
  for (const precondition of transaction.preconditions ?? []) {
    const target =
      precondition.scope === 'node'
        ? document.nodes[precondition.id]
        : document.tokens[precondition.id]
    const actualHash = valueHash(valueAtPath(target, precondition.path))
    if (actualHash !== precondition.hash) {
      conflicts.push({ transactionId: transaction.id, precondition, actualHash })
    }
  }
  return conflicts
}

function mergeLayout(layout: CanvasLayout, patch: Partial<CanvasLayout> | undefined) {
  if (!patch) return layout
  const next = {
    ...layout,
    ...patch,
  }
  if (patch.padding !== undefined) {
    next.padding = {
      ...(layout.padding ?? { top: 0, right: 0, bottom: 0, left: 0 }),
      ...patch.padding,
    }
  }
  return next
}

function mergeStyle(style: CanvasStyle, patch: Partial<CanvasStyle> | undefined) {
  if (!patch) return style
  const next = {
    ...style,
    ...patch,
  }
  if (patch.typography !== undefined) {
    next.typography = {
      ...style.typography,
      ...patch.typography,
    } as CanvasStyle['typography']
  }
  return next
}

function patchNode(
  node: CanvasNode,
  patch: NodeMutationPatch,
  replace: (keyof NodeMutationPatch)[] = [],
  unset: (keyof NodeMutationPatch)[] = [],
): CanvasNode {
  const replaceFields = new Set<keyof NodeMutationPatch>(replace)
  const next = {
    ...node,
    ...patch,
    layout: replaceFields.has('layout')
      ? patch.layout as CanvasLayout
      : mergeLayout(node.layout, patch.layout),
    style: replaceFields.has('style')
      ? patch.style as CanvasStyle
      : mergeStyle(node.style, patch.style),
    responsive: patch.responsive
      ? replaceFields.has('responsive')
        ? patch.responsive
        : { ...node.responsive, ...patch.responsive }
      : node.responsive,
  } as CanvasNode
  if (patch.metadata) {
    next.metadata = { ...(node.metadata ?? {}), ...patch.metadata }
  } else if (node.metadata !== undefined) {
    next.metadata = node.metadata
  } else {
    delete next.metadata
  }
  if (node.type === 'page' && patch.viewport) {
    ;(next as Extract<CanvasNode, { type: 'page' }>).viewport =
      replaceFields.has('viewport')
        ? patch.viewport as Extract<CanvasNode, { type: 'page' }>['viewport']
        : { ...node.viewport, ...patch.viewport }
  }
  for (const key of unset) {
    delete (next as unknown as Record<string, unknown>)[key]
  }
  return next
}

function descendants(document: CanvasDocument, id: NodeId) {
  const result: CanvasNode[] = []
  const queue = [id]
  while (queue.length > 0) {
    const current = queue.shift()!
    const node = document.nodes[current]
    if (!node) continue
    result.push(node)
    for (const child of orderedChildren(document, current)) queue.push(child.id)
  }
  return result
}

function inverseId(transactionId: string) {
  return `${transactionId}:inverse`
}

export function applyTransaction(
  source: CanvasDocument,
  transaction: CanvasTransaction,
  options: {
    checkPreconditions?: boolean
    validateDocument?: boolean
  } = {},
): CanvasApplyResult {
  if (options.checkPreconditions !== false) {
    const conflicts = verifyPreconditions(source, transaction)
    if (conflicts.length > 0) {
      throw new CanvasConflictError(conflicts)
    }
  }

  const document: CanvasDocument = {
    ...source,
    nodes: { ...source.nodes },
    tokens: { ...source.tokens },
    breakpoints: source.breakpoints,
    metadata: { ...source.metadata },
  }
  const inverseOperations: CanvasOperation[] = []
  const changedNodeIds = new Set<NodeId>()
  const changedTokenIds = new Set<string>()

  for (const operation of transaction.operations) {
    switch (operation.type) {
      case 'node.insert': {
        if (document.nodes[operation.node.id]) {
          throw new Error(`Node ${operation.node.id} already exists`)
        }
        document.nodes[operation.node.id] = clone(operation.node)
        inverseOperations.unshift({ type: 'node.delete', id: operation.node.id })
        changedNodeIds.add(operation.node.id)
        if (operation.node.parentId) changedNodeIds.add(operation.node.parentId)
        break
      }
      case 'node.patch': {
        const current = document.nodes[operation.id]
        if (!current) throw new Error(`Node ${operation.id} does not exist`)
        const before: NodeMutationPatch = {}
        const unset: (keyof NodeMutationPatch)[] = []
        for (const key of Object.keys(operation.patch) as (keyof NodeMutationPatch)[]) {
          if (Object.prototype.hasOwnProperty.call(current, key)) {
            ;(before as Record<string, unknown>)[key] = clone(
              (current as unknown as Record<string, unknown>)[key as string],
            )
          } else {
            unset.push(key)
          }
        }
        for (const key of operation.unset ?? []) {
          if (Object.prototype.hasOwnProperty.call(current, key)) {
            ;(before as Record<string, unknown>)[key] = clone(
              (current as unknown as Record<string, unknown>)[key as string],
            )
          }
        }
        document.nodes[operation.id] = patchNode(
          current,
          operation.patch,
          operation.replace,
          operation.unset,
        )
        inverseOperations.unshift({
          type: 'node.patch',
          id: operation.id,
          patch: before,
          replace: Object.keys(before) as (keyof NodeMutationPatch)[],
          unset,
        })
        changedNodeIds.add(operation.id)
        break
      }
      case 'node.move': {
        const current = document.nodes[operation.id]
        if (!current) throw new Error(`Node ${operation.id} does not exist`)
        inverseOperations.unshift({
          type: 'node.move',
          id: operation.id,
          parentId: current.parentId,
          order: current.order,
        })
        if (current.parentId) changedNodeIds.add(current.parentId)
        if (operation.parentId) changedNodeIds.add(operation.parentId)
        document.nodes[operation.id] = {
          ...current,
          parentId: operation.parentId,
          order: operation.order,
        }
        changedNodeIds.add(operation.id)
        break
      }
      case 'node.delete': {
        const removed = descendants(document, operation.id)
        if (removed.length === 0) throw new Error(`Node ${operation.id} does not exist`)
        const removedRootParent = removed[0]?.parentId
        if (removedRootParent) changedNodeIds.add(removedRootParent)
        for (const node of removed) {
          delete document.nodes[node.id]
          changedNodeIds.add(node.id)
        }
        const removedIds = new Set(removed.map((node) => node.id))
        for (const node of Object.values(document.nodes)) {
          if (node.type !== 'instance') continue
          if (removedIds.has(node.componentId)) {
            throw new Error(`Cannot delete component ${node.componentId} while instances use it`)
          }
        }
        for (const node of removed.sort((left, right) => {
          if (left.parentId === right.id) return 1
          if (right.parentId === left.id) return -1
          return left.order - right.order
        })) {
          inverseOperations.unshift({ type: 'node.insert', node: clone(node) })
        }
        break
      }
      case 'instance.patchOverride': {
        const current = document.nodes[operation.id]
        if (!current || current.type !== 'instance') {
          throw new Error(`Instance ${operation.id} does not exist`)
        }
        const previous = current.overrides[operation.targetId] ?? null
        const overrides = { ...current.overrides }
        if (operation.patch === null) delete overrides[operation.targetId]
        else {
          overrides[operation.targetId] = operation.replace
            ? operation.patch
            : { ...previous, ...operation.patch }
        }
        document.nodes[operation.id] = { ...current, overrides }
        inverseOperations.unshift({
          type: 'instance.patchOverride',
          id: operation.id,
          targetId: operation.targetId,
          patch: previous,
          replace: true,
        })
        changedNodeIds.add(operation.id)
        break
      }
      case 'token.upsert': {
        const previous = document.tokens[operation.token.id]
        document.tokens[operation.token.id] = clone(operation.token)
        inverseOperations.unshift(
          previous
            ? { type: 'token.upsert', token: clone(previous) }
            : { type: 'token.delete', id: operation.token.id },
        )
        changedTokenIds.add(operation.token.id)
        break
      }
      case 'token.delete': {
        const previous = document.tokens[operation.id]
        if (!previous) throw new Error(`Token ${operation.id} does not exist`)
        delete document.tokens[operation.id]
        inverseOperations.unshift({ type: 'token.upsert', token: clone(previous) })
        changedTokenIds.add(operation.id)
        break
      }
    }
  }

  document.metadata.updatedAt = transaction.documentUpdatedAt ?? Date.now()
  if (options.validateDocument !== false) assertDocument(document)
  return {
    document,
    inverse: {
      id: inverseId(transaction.id),
      label: `Undo ${transaction.label}`,
      operations: inverseOperations,
      createdAt: Date.now(),
      documentUpdatedAt: source.metadata.updatedAt,
    },
    changedNodeIds,
    changedTokenIds,
    idempotent: false,
  }
}

function canValidateIncrementally(
  document: CanvasDocument,
  transaction: CanvasTransaction,
) {
  return transaction.operations.every(
    (operation) =>
      operation.type === 'node.patch' &&
      !operation.replace?.length &&
      !operation.unset?.length &&
      !!document.nodes[operation.id] &&
      validateCommonNodeMutationPatch(document, operation.patch),
  )
}

export class CanvasConflictError extends Error {
  readonly conflicts: CanvasTransactionConflict[]

  constructor(conflicts: CanvasTransactionConflict[]) {
    super('Canvas transaction preconditions failed')
    this.name = 'CanvasConflictError'
    this.conflicts = conflicts
  }
}

export function rebaseTransactions(
  remote: CanvasDocument,
  transactions: CanvasTransaction[],
): CanvasRebaseResult {
  let document = remote
  const conflicts: CanvasTransactionConflict[] = []
  for (const transaction of transactions) {
    const current = verifyPreconditions(document, transaction)
    if (current.length > 0) {
      conflicts.push(...current)
      continue
    }
    document = applyTransaction(document, transaction).document
  }
  return conflicts.length > 0
    ? { ok: false, document, conflicts }
    : { ok: true, document, transactions }
}

export function orderBetween(
  previous: number | undefined,
  next: number | undefined,
): number | null {
  if (previous === undefined && next === undefined) return DEFAULT_ORDER_STEP
  if (previous === undefined) return next! - DEFAULT_ORDER_STEP
  if (next === undefined) return previous + DEFAULT_ORDER_STEP
  if (next - previous <= MIN_ORDER_GAP) return null
  return previous + (next - previous) / 2
}

export function rebalanceSiblingOperations(
  document: CanvasDocument,
  parentId: NodeId | null,
): CanvasOperation[] {
  return orderedChildren(document, parentId).map((node, index) => ({
    type: 'node.patch' as const,
    id: node.id,
    patch: { order: (index + 1) * DEFAULT_ORDER_STEP },
  }))
}

type Listener = () => void

interface HistoryEntry {
  transaction: CanvasTransaction
  coalesceKey?: string
  timestamp: number
}

export interface CanvasBounds {
  id: NodeId
  x: number
  y: number
  width: number
  height: number
}

export class CanvasEngine {
  #document: CanvasDocument
  #undo: HistoryEntry[] = []
  #redo: HistoryEntry[] = []
  #listeners = new Set<Listener>()
  #nodeListeners = new Map<NodeId, Set<Listener>>()
  #nodeRevisions = new Map<NodeId, number>()
  #children = new Map<NodeId | null, NodeId[]>()
  #topLevelBounds = new Map<NodeId, CanvasBounds>()
  #appliedTransactionIds = new Set<string>()
  #appliedTransactionOrder: string[] = []
  #revision = 0

  constructor(document: CanvasDocument) {
    this.#document = assertDocument(clone(document))
    this.#rebuildIndexes()
  }

  get document() {
    return this.#document
  }

  get revision() {
    return this.#revision
  }

  getNode(id: NodeId) {
    return this.#document.nodes[id] ?? null
  }

  getChildren(parentId: NodeId | null) {
    return (this.#children.get(parentId) ?? [])
      .map((id) => this.#document.nodes[id])
      .filter((node): node is CanvasNode => !!node)
  }

  searchTopLevelBounds(bounds: Omit<CanvasBounds, 'id'>) {
    const right = bounds.x + bounds.width
    const bottom = bounds.y + bounds.height
    return [...this.#topLevelBounds.values()].filter((candidate) => {
      const candidateRight = candidate.x + candidate.width
      const candidateBottom = candidate.y + candidate.height
      return (
        candidate.x <= right &&
        candidateRight >= bounds.x &&
        candidate.y <= bottom &&
        candidateBottom >= bounds.y
      )
    })
  }

  get canUndo() {
    return this.#undo.length > 0
  }

  get canRedo() {
    return this.#redo.length > 0
  }

  getNodeRevision(id: NodeId) {
    return this.#nodeRevisions.get(id) ?? 0
  }

  subscribe(listener: Listener) {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  subscribeNode(id: NodeId, listener: Listener) {
    const listeners = this.#nodeListeners.get(id) ?? new Set<Listener>()
    listeners.add(listener)
    this.#nodeListeners.set(id, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.#nodeListeners.delete(id)
    }
  }

  apply(transaction: CanvasTransaction, options: { recordHistory?: boolean } = {}) {
    const parsed = parseCanvasTransaction(
      withTransactionPreconditions(this.#document, transaction),
    )
    if (this.#appliedTransactionIds.has(parsed.id)) {
      return {
        document: this.#document,
        inverse: {
          id: `${parsed.id}:idempotent`,
          label: `Already applied ${parsed.label}`,
          operations: [],
        },
        changedNodeIds: new Set<NodeId>(),
        changedTokenIds: new Set<string>(),
        idempotent: true,
      }
    }
    const previous = this.#document
    const result = applyTransaction(this.#document, parsed, {
      validateDocument: !canValidateIncrementally(this.#document, parsed),
    })
    this.#document = result.document
    this.#updateIndexes(previous, result.document, result.changedNodeIds)
    this.#rememberTransaction(parsed.id)
    if (options.recordHistory !== false) {
      const timestamp = parsed.createdAt ?? Date.now()
      const previousEntry = this.#undo.at(-1)
      if (
        parsed.coalesceKey &&
        previousEntry?.coalesceKey === parsed.coalesceKey &&
        timestamp - previousEntry.timestamp <= 750
      ) {
        previousEntry.transaction = {
          ...result.inverse,
          operations: [
            ...result.inverse.operations,
            ...previousEntry.transaction.operations,
          ],
          documentUpdatedAt: previousEntry.transaction.documentUpdatedAt,
        }
        previousEntry.timestamp = timestamp
      } else {
        this.#undo.push({
          transaction: result.inverse,
          coalesceKey: parsed.coalesceKey,
          timestamp,
        })
      }
      this.#redo = []
    }
    this.#emit(result.changedNodeIds)
    return result
  }

  replaceDocument(document: CanvasDocument) {
    this.#document = assertDocument(clone(document))
    this.#undo = []
    this.#redo = []
    this.#appliedTransactionIds.clear()
    this.#appliedTransactionOrder = []
    this.#rebuildIndexes()
    this.#emit(new Set(Object.keys(document.nodes)))
  }

  undo(): CanvasHistoryResult | null {
    const entry = this.#undo.pop()
    if (!entry) return null
    const previous = this.#document
    const result = applyTransaction(this.#document, entry.transaction, { checkPreconditions: false })
    this.#document = result.document
    this.#updateIndexes(previous, result.document, result.changedNodeIds)
    this.#redo.push({
      transaction: result.inverse,
      coalesceKey: entry.coalesceKey,
      timestamp: Date.now(),
    })
    this.#emit(result.changedNodeIds)
    return { ...result, transaction: entry.transaction }
  }

  redo(): CanvasHistoryResult | null {
    const entry = this.#redo.pop()
    if (!entry) return null
    const previous = this.#document
    const result = applyTransaction(this.#document, entry.transaction, { checkPreconditions: false })
    this.#document = result.document
    this.#updateIndexes(previous, result.document, result.changedNodeIds)
    this.#undo.push({
      transaction: result.inverse,
      coalesceKey: entry.coalesceKey,
      timestamp: Date.now(),
    })
    this.#emit(result.changedNodeIds)
    return { ...result, transaction: entry.transaction }
  }

  #rememberTransaction(id: string) {
    this.#appliedTransactionIds.add(id)
    this.#appliedTransactionOrder.push(id)
    if (this.#appliedTransactionOrder.length <= 5_000) return
    const oldest = this.#appliedTransactionOrder.shift()
    if (oldest) this.#appliedTransactionIds.delete(oldest)
  }

  #rebuildIndexes() {
    this.#children.clear()
    this.#topLevelBounds.clear()
    for (const node of Object.values(this.#document.nodes)) {
      const children = this.#children.get(node.parentId) ?? []
      children.push(node.id)
      this.#children.set(node.parentId, children)
      this.#indexBounds(node)
    }
    for (const ids of this.#children.values()) this.#sortChildren(ids)
  }

  #updateIndexes(
    previous: CanvasDocument,
    next: CanvasDocument,
    changedNodeIds: Set<NodeId>,
  ) {
    const affectedParents = new Set<NodeId | null>()
    for (const id of changedNodeIds) {
      const before = previous.nodes[id]
      const after = next.nodes[id]
      if (before) {
        affectedParents.add(before.parentId)
        this.#topLevelBounds.delete(id)
      }
      if (after) {
        affectedParents.add(after.parentId)
        this.#indexBounds(after)
      }
      if (!after) this.#children.delete(id)
    }
    for (const parentId of affectedParents) {
      const current = this.#children.get(parentId) ?? []
      const retained = current.filter((id) => {
        const node = next.nodes[id]
        return !!node && node.parentId === parentId && !changedNodeIds.has(id)
      })
      for (const id of changedNodeIds) {
        const node = next.nodes[id]
        if (node?.parentId === parentId) retained.push(id)
      }
      this.#sortChildren(retained)
      if (retained.length === 0) this.#children.delete(parentId)
      else this.#children.set(parentId, retained)
    }
  }

  #sortChildren(ids: NodeId[]) {
    ids.sort((leftId, rightId) => {
      const left = this.#document.nodes[leftId]
      const right = this.#document.nodes[rightId]
      if (!left || !right) return left ? -1 : right ? 1 : 0
      return left.order - right.order || left.id.localeCompare(right.id)
    })
  }

  #indexBounds(node: CanvasNode) {
    if (node.parentId !== null || node.layout.position !== 'absolute') return
    if (node.layout.width.unit !== 'px' || node.layout.height.unit !== 'px') return
    this.#topLevelBounds.set(node.id, {
      id: node.id,
      x: node.layout.x,
      y: node.layout.y,
      width: node.layout.width.value,
      height: node.layout.height.value,
    })
  }

  #emit(changedNodeIds: Set<NodeId>) {
    this.#revision += 1
    for (const id of changedNodeIds) {
      this.#nodeRevisions.set(id, (this.#nodeRevisions.get(id) ?? 0) + 1)
      for (const listener of this.#nodeListeners.get(id) ?? []) listener()
    }
    for (const listener of this.#listeners) listener()
  }
}
