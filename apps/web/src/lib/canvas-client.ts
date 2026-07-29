import {
  CanvasEngine,
  applyTransaction,
  rebaseTransactions,
  type CanvasTransaction,
  type CanvasTransactionConflict,
} from '@loora/canvas/engine'
import {
  parseCanvasDocument,
  type CanvasDocument,
} from '@loora/canvas/model'
import { orpc } from '#/lib/orpc-client'

export interface CanvasSyncTarget {
  designId: string
  draftId: string | null
}

export interface CanvasAgentActivity {
  id: string
  label: string
  nodeIds: string[]
  phase: 'working' | 'settled'
  updatedAt: number
}

export interface CanvasRemoteChange {
  sequence: number
  revision: number
  nodeIds: string[]
}

export type CanvasSyncStatus =
  | 'ready'
  | 'offline'
  | 'syncing'
  | 'conflict'
  | 'closed'

interface PendingRecord {
  key: string
  transactions: CanvasTransaction[]
}

const DATABASE_NAME = 'loora-canvas'
const STORE_NAME = 'pending-transactions'
const REMOTE_REFRESH_INTERVAL_MS = 800

function targetKey(target: CanvasSyncTarget) {
  return `${target.designId}:${target.draftId ?? 'main'}`
}

export function remoteRevealNodeIds(transactions: CanvasTransaction[]) {
  const candidates: string[] = []
  const insertedParents = new Map<string, string | null>()
  const add = (id: string) => {
    if (!candidates.includes(id)) candidates.push(id)
  }

  for (const transaction of transactions) {
    for (const operation of transaction.operations) {
      if (operation.type === 'node.insert') {
        insertedParents.set(operation.node.id, operation.node.parentId)
        add(operation.node.id)
      } else if (
        operation.type === 'node.patch' ||
        operation.type === 'node.move'
      ) {
        add(operation.id)
      } else if (operation.type === 'instance.patchOverride') {
        add(operation.id)
      }
    }
  }

  return candidates.filter((id) => {
    let parentId = insertedParents.get(id)
    while (parentId) {
      if (insertedParents.has(parentId)) return false
      parentId = insertedParents.get(parentId)
    }
    return true
  })
}

function changedSnapshotNodeIds(
  previous: CanvasDocument,
  next: CanvasDocument,
) {
  const ids = new Set([
    ...Object.keys(previous.nodes),
    ...Object.keys(next.nodes),
  ])
  return [...ids].filter(
    (id) =>
      JSON.stringify(previous.nodes[id]) !== JSON.stringify(next.nodes[id]),
  )
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

async function openDatabase() {
  if (typeof indexedDB === 'undefined') return null
  const request = indexedDB.open(DATABASE_NAME, 1)
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
    }
  }
  return requestResult(request)
}

async function readPending(key: string) {
  const database = await openDatabase()
  if (!database) return [] as CanvasTransaction[]
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const record = await requestResult(
      transaction.objectStore(STORE_NAME).get(key) as IDBRequest<PendingRecord | undefined>,
    )
    return record?.transactions ?? []
  } finally {
    database.close()
  }
}

async function writePending(key: string, transactions: CanvasTransaction[]) {
  const database = await openDatabase()
  if (!database) return
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    if (transactions.length === 0) store.delete(key)
    else store.put({ key, transactions } satisfies PendingRecord)
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('IndexedDB transaction failed'))
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('IndexedDB transaction was aborted'))
    })
  } finally {
    database.close()
  }
}

type Listener = () => void

export class CanvasSyncController {
  readonly engine: CanvasEngine
  readonly target: CanvasSyncTarget
  #baseDocument: CanvasDocument
  #revision: number
  #pending: CanvasTransaction[]
  #status: CanvasSyncStatus = 'ready'
  #conflicts: CanvasTransactionConflict[] = []
  #agentActivity: CanvasAgentActivity | null = null
  #remoteChange: CanvasRemoteChange | null = null
  #remoteChangeSequence = 0
  #listeners = new Set<Listener>()
  #timer: ReturnType<typeof setTimeout> | null = null
  #refreshTimer: ReturnType<typeof setTimeout> | null = null
  #flushing: Promise<void> | null = null
  #refreshing: Promise<void> | null = null
  #closed = false

  private constructor(
    target: CanvasSyncTarget,
    document: CanvasDocument,
    revision: number,
    pending: CanvasTransaction[],
  ) {
    this.target = target
    this.#baseDocument = document
    this.#revision = revision
    this.#pending = pending
    const rebased = rebaseTransactions(document, pending)
    if (rebased.ok) {
      this.engine = new CanvasEngine(rebased.document)
    } else {
      this.engine = new CanvasEngine(rebased.document)
      this.#status = 'conflict'
      this.#conflicts = rebased.conflicts
    }
    window.addEventListener('online', this.#online)
    window.addEventListener('offline', this.#offline)
    window.addEventListener('pagehide', this.#pageHide)
    window.document.addEventListener(
      'visibilitychange',
      this.#visibilityChange,
    )
  }

  static async open(
    target: CanvasSyncTarget,
    document: CanvasDocument,
    revision: number,
  ) {
    const pending = await readPending(targetKey(target))
    const controller = new CanvasSyncController(
      target,
      parseCanvasDocument(document),
      revision,
      pending,
    )
    if (pending.length > 0 && controller.#status !== 'conflict') {
      controller.#schedule(0)
    }
    controller.#scheduleRefresh(0)
    return controller
  }

  get status() {
    return this.#status
  }

  get revision() {
    return this.#revision
  }

  get pendingCount() {
    return this.#pending.length
  }

  get conflicts() {
    return this.#conflicts
  }

  get agentActivity() {
    return this.#agentActivity
  }

  get remoteChange() {
    return this.#remoteChange
  }

  subscribe = (listener: Listener) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  enqueue(transaction: CanvasTransaction) {
    if (this.#closed) throw new Error('Canvas sync controller is closed')
    if (this.#pending.some((pending) => pending.id === transaction.id)) return
    this.#pending.push(structuredClone(transaction))
    void writePending(targetKey(this.target), this.#pending)
    this.#schedule(250)
    this.#emit()
  }

  async flush() {
    if (this.#closed || this.#pending.length === 0 || this.#status === 'conflict') return
    if (this.#flushing) return this.#flushing
    this.#flushing = this.#flush()
    try {
      await this.#flushing
    } finally {
      this.#flushing = null
    }
  }

  async refresh() {
    if (this.#closed || !navigator.onLine) return
    if (this.#flushing) return
    if (this.#refreshing) return this.#refreshing
    this.#refreshing = this.#refresh()
    try {
      await this.#refreshing
    } finally {
      this.#refreshing = null
    }
  }

  async close() {
    if (this.#closed) return
    if (this.#timer) clearTimeout(this.#timer)
    if (this.#refreshTimer) clearTimeout(this.#refreshTimer)
    await this.flush()
    this.#closed = true
    if (this.#refreshTimer) clearTimeout(this.#refreshTimer)
    this.#status = 'closed'
    window.removeEventListener('online', this.#online)
    window.removeEventListener('offline', this.#offline)
    window.removeEventListener('pagehide', this.#pageHide)
    document.removeEventListener('visibilitychange', this.#visibilityChange)
    this.#emit()
  }

  async adoptSnapshot(document: CanvasDocument, revision: number) {
    if (this.#closed) throw new Error('Canvas sync controller is closed')
    if (this.#pending.length > 0) {
      throw new Error('Pending canvas changes must be saved before replacing the snapshot')
    }
    const parsed = parseCanvasDocument(document)
    this.#baseDocument = parsed
    this.#revision = revision
    this.#conflicts = []
    this.#status = 'ready'
    this.engine.replaceDocument(parsed)
    await writePending(targetKey(this.target), [])
    this.#emit()
  }

  async #refresh() {
    if (document.visibilityState === 'hidden') return
    try {
      const result = await orpc.canvas.get({
        designId: this.target.designId,
        draftId: this.target.draftId,
        sinceRevision: this.#revision,
      })
      if (result.status !== 'ready') return
      this.#setAgentActivity(result.activity)
      if (result.revision <= this.#revision) {
        if (this.#status === 'offline') {
          this.#status = 'ready'
          this.#emit()
        }
        return
      }

      const previous = this.#baseDocument
      let remote = result.document
        ? parseCanvasDocument(result.document)
        : previous
      const changedNodeIds = new Set<string>()
      if (result.document) {
        for (const id of changedSnapshotNodeIds(previous, remote)) {
          changedNodeIds.add(id)
        }
      } else {
        for (const transaction of result.transactions) {
          const applied = applyTransaction(remote, transaction)
          remote = applied.document
          for (const id of applied.changedNodeIds) changedNodeIds.add(id)
        }
      }

      this.#baseDocument = remote
      this.#revision = result.revision
      const rebased = rebaseTransactions(remote, this.#pending)
      const revealNodeIds = result.document
        ? [...changedNodeIds]
        : remoteRevealNodeIds(result.transactions)
      if (revealNodeIds.length > 0) {
        this.#remoteChangeSequence += 1
        this.#remoteChange = {
          sequence: this.#remoteChangeSequence,
          revision: result.revision,
          nodeIds: revealNodeIds,
        }
      }
      this.engine.replaceDocument(rebased.document)
      if (!rebased.ok) {
        this.#status = 'conflict'
        this.#conflicts = rebased.conflicts
      } else {
        this.#status = 'ready'
        this.#conflicts = []
      }
      this.#emit()
    } catch {
      if (!this.#closed && this.#status !== 'conflict') {
        this.#status = 'offline'
        this.#emit()
      }
    }
  }

  async #flush() {
    if (this.#refreshing) await this.#refreshing
    if (!navigator.onLine) {
      this.#status = 'offline'
      this.#emit()
      return
    }
    const batch = [...this.#pending]
    if (batch.length === 0) return
    this.#status = 'syncing'
    this.#emit()
    try {
      const result = await orpc.canvas.applyTransactions({
        designId: this.target.designId,
        draftId: this.target.draftId,
        expectedRevision: this.#revision,
        transactions: batch,
      })
      if (result.applied) {
        const acknowledged = new Set(result.transactionIds)
        this.#pending = this.#pending.filter(
          (transaction) => !acknowledged.has(transaction.id),
        )
        this.#baseDocument = parseCanvasDocument(result.document)
        this.#revision = result.revision
        this.#status = 'ready'
        this.#conflicts = []
        await writePending(targetKey(this.target), this.#pending)
        this.#emit()
        if (this.#pending.length > 0) this.#schedule(0)
        return
      }
      if (result.reason === 'conflict') {
        this.#status = 'conflict'
        this.#conflicts = result.conflicts
        this.#emit()
        return
      }
      let remote = result.document
        ? parseCanvasDocument(result.document)
        : this.#baseDocument
      const revealNodeIds = result.document
        ? changedSnapshotNodeIds(this.#baseDocument, remote)
        : remoteRevealNodeIds(result.transactions)
      if (!result.document) {
        for (const transaction of result.transactions) {
          remote = applyTransaction(remote, transaction).document
        }
      }
      this.#baseDocument = remote
      this.#revision = result.revision
      if (revealNodeIds.length > 0) {
        this.#remoteChangeSequence += 1
        this.#remoteChange = {
          sequence: this.#remoteChangeSequence,
          revision: result.revision,
          nodeIds: revealNodeIds,
        }
      }
      const rebased = rebaseTransactions(remote, this.#pending)
      if (!rebased.ok) {
        this.engine.replaceDocument(rebased.document)
        this.#status = 'conflict'
        this.#conflicts = rebased.conflicts
        this.#emit()
        return
      }
      this.engine.replaceDocument(rebased.document)
      this.#status = 'ready'
      this.#emit()
      this.#schedule(0)
    } catch {
      this.#status = navigator.onLine ? 'offline' : 'offline'
      this.#emit()
    }
  }

  #schedule(delay: number) {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#timer = null
      void this.flush()
    }, delay)
  }

  #scheduleRefresh(delay: number) {
    if (this.#closed) return
    if (this.#refreshTimer) clearTimeout(this.#refreshTimer)
    this.#refreshTimer = setTimeout(() => {
      this.#refreshTimer = null
      void this.refresh().finally(() => {
        this.#scheduleRefresh(
          document.visibilityState === 'hidden'
            ? 5_000
            : REMOTE_REFRESH_INTERVAL_MS,
        )
      })
    }, delay)
  }

  #setAgentActivity(activity: CanvasAgentActivity | null) {
    const current = this.#agentActivity
    if (
      current?.id === activity?.id &&
      current?.phase === activity?.phase &&
      current?.updatedAt === activity?.updatedAt &&
      current?.label === activity?.label &&
      current?.nodeIds.join('\u0000') === activity?.nodeIds.join('\u0000')
    ) {
      return
    }
    this.#agentActivity = activity
      ? { ...activity, nodeIds: [...activity.nodeIds] }
      : null
    this.#emit()
  }

  #online = () => {
    if (this.#status === 'offline') this.#status = 'ready'
    this.#emit()
    this.#schedule(0)
    this.#scheduleRefresh(0)
  }

  #offline = () => {
    this.#status = 'offline'
    this.#emit()
  }

  #pageHide = () => {
    void writePending(targetKey(this.target), this.#pending)
    void this.flush()
  }

  #visibilityChange = () => {
    if (document.visibilityState === 'visible') this.#scheduleRefresh(0)
  }

  #emit() {
    for (const listener of this.#listeners) listener()
  }
}
