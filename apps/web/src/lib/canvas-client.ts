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

function targetKey(target: CanvasSyncTarget) {
  return `${target.designId}:${target.draftId ?? 'main'}`
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
  #listeners = new Set<Listener>()
  #timer: ReturnType<typeof setTimeout> | null = null
  #flushing: Promise<void> | null = null
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

  async close() {
    if (this.#closed) return
    if (this.#timer) clearTimeout(this.#timer)
    await this.flush()
    this.#closed = true
    this.#status = 'closed'
    window.removeEventListener('online', this.#online)
    window.removeEventListener('offline', this.#offline)
    window.removeEventListener('pagehide', this.#pageHide)
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

  async #flush() {
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
      if (!result.document) {
        for (const transaction of result.transactions) {
          remote = applyTransaction(remote, transaction).document
        }
      }
      this.#baseDocument = remote
      this.#revision = result.revision
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

  #online = () => {
    if (this.#status === 'offline') this.#status = 'ready'
    this.#emit()
    this.#schedule(0)
  }

  #offline = () => {
    this.#status = 'offline'
    this.#emit()
  }

  #pageHide = () => {
    void writePending(targetKey(this.target), this.#pending)
    void this.flush()
  }

  #emit() {
    for (const listener of this.#listeners) listener()
  }
}
