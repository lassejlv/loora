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
  expiresAt?: number
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
const REALTIME_CONNECTED_REFRESH_MS = 5 * 60_000
const REALTIME_DISCONNECTED_REFRESH_MS = 15_000
const REALTIME_RETRY_MAX_MS = 30_000
/** The socket service asking for a fresh ticket, not a broken connection. */
const CLOSE_REALTIME_REAUTH = 4001
/** After this many sockets that never opened, stay on the event stream. */
const MAX_SOCKET_FAILURES = 3
/** A pointer moves at frame rate; the wire does not have to. */
const PRESENCE_THROTTLE_MS = 80
const PRESENCE_HEARTBEAT_MS = 20_000
/** Matches the server's expiry, so a tab that died stops being drawn. */
const PRESENCE_TTL_MS = 45_000

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

export function applyAcknowledgedTransactions(
  base: CanvasDocument,
  transactions: CanvasTransaction[],
  transactionIds: string[],
) {
  const acknowledged = new Set(transactionIds)
  let document = base
  for (const transaction of transactions) {
    if (!acknowledged.has(transaction.id)) continue
    document = applyTransaction(document, transaction).document
  }
  return document
}

export interface CanvasPeer {
  sessionId: string
  userId: string
  name: string
  image: string | null
  color: string
  role: 'owner' | 'edit' | 'view'
  cursor: { x: number; y: number } | null
  selection: string[]
  updatedAt: number
}

type CanvasRealtimeMessage =
  | {
      type: 'canvas.changed'
      revision: number
      nodeIds: string[]
      sentAt: number
    }
  /** The socket service's opening frame: the room as it stands right now. */
  | {
      type: 'ready'
      sessionId: string
      role: 'owner' | 'edit' | 'view'
      peers: CanvasPeer[]
      activity: CanvasAgentActivity | null
      sentAt: number
    }
  | {
      type: 'pong'
      sentAt: number
    }
  | {
      type: 'agent.activity'
      activity: CanvasAgentActivity | null
      sentAt: number
    }
  | {
      type: 'presence.peer'
      sessionId: string
      peer: CanvasPeer | null
      sentAt: number
    }
  | {
      type: 'presence.state'
      peers: CanvasPeer[]
      sentAt: number
    }

function isPeer(value: unknown): value is CanvasPeer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const peer = value as Record<string, unknown>
  return (
    typeof peer.sessionId === 'string' &&
    typeof peer.userId === 'string' &&
    typeof peer.name === 'string' &&
    (peer.image === null || typeof peer.image === 'string') &&
    typeof peer.color === 'string' &&
    (peer.role === 'owner' || peer.role === 'edit' || peer.role === 'view') &&
    (peer.cursor === null ||
      (!!peer.cursor &&
        typeof peer.cursor === 'object' &&
        Number.isFinite((peer.cursor as Record<string, unknown>).x) &&
        Number.isFinite((peer.cursor as Record<string, unknown>).y))) &&
    Array.isArray(peer.selection) &&
    peer.selection.every((id) => typeof id === 'string') &&
    Number.isFinite(peer.updatedAt)
  )
}

function isAgentActivity(value: unknown): value is CanvasAgentActivity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const activity = value as Record<string, unknown>
  return (
    typeof activity.id === 'string' &&
    typeof activity.label === 'string' &&
    Array.isArray(activity.nodeIds) &&
    activity.nodeIds.every((id) => typeof id === 'string') &&
    (activity.phase === 'working' || activity.phase === 'settled') &&
    Number.isFinite(activity.updatedAt) &&
    Number.isFinite(activity.expiresAt)
  )
}

export function parseCanvasRealtimeMessage(
  value: string,
): CanvasRealtimeMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }
  const event = parsed as Record<string, unknown>
  if (!Number.isFinite(event.sentAt)) return null
  if (
    event.type === 'canvas.changed' &&
    Number.isInteger(event.revision) &&
    Number(event.revision) >= 0 &&
    Array.isArray(event.nodeIds) &&
    event.nodeIds.every((id) => typeof id === 'string')
  ) {
    return parsed as CanvasRealtimeMessage
  }
  if (
    event.type === 'presence.peer' &&
    typeof event.sessionId === 'string' &&
    (event.peer === null || isPeer(event.peer))
  ) {
    return parsed as CanvasRealtimeMessage
  }
  if (
    event.type === 'presence.state' &&
    Array.isArray(event.peers) &&
    event.peers.every(isPeer)
  ) {
    return parsed as CanvasRealtimeMessage
  }
  if (
    event.type === 'ready' &&
    typeof event.sessionId === 'string' &&
    (event.role === 'owner' || event.role === 'edit' || event.role === 'view') &&
    Array.isArray(event.peers) &&
    event.peers.every(isPeer) &&
    (event.activity === null || isAgentActivity(event.activity))
  ) {
    return parsed as CanvasRealtimeMessage
  }
  if (event.type === 'pong') return parsed as CanvasRealtimeMessage
  if (event.type !== 'agent.activity') return null
  if (event.activity === null) return parsed as CanvasRealtimeMessage
  return isAgentActivity(event.activity)
    ? (parsed as CanvasRealtimeMessage)
    : null
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
  #presenceListeners = new Set<Listener>()
  #timer: ReturnType<typeof setTimeout> | null = null
  #refreshTimer: ReturnType<typeof setTimeout> | null = null
  #activityTimer: ReturnType<typeof setTimeout> | null = null
  #realtimeRetryTimer: ReturnType<typeof setTimeout> | null = null
  #eventSource: EventSource | null = null
  #socket: WebSocket | null = null
  /** Guards the async ticket fetch against a target that moved on. */
  #socketAttempt = 0
  #socketFailures = 0
  #transport: 'auto' | 'sse' = 'auto'
  #realtimeConnected = false
  #realtimeRetryDelay = 1_000
  #announcedRevision = 0
  #flushing: Promise<void> | null = null
  #refreshing: Promise<void> | null = null
  #closed = false
  readonly #sessionId = crypto.randomUUID()
  #peers = new Map<string, CanvasPeer>()
  #peerList: CanvasPeer[] = []
  #presence: { cursor: { x: number; y: number } | null; selection: string[] } = {
    cursor: null,
    selection: [],
  }
  #presenceSentAt = 0
  #presenceTimer: ReturnType<typeof setTimeout> | null = null
  #presenceHeartbeat: ReturnType<typeof setInterval> | null = null
  #presenceExpiry: ReturnType<typeof setInterval> | null = null

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
    controller.#connectRealtime()
    controller.#scheduleRefresh(0)
    controller.#startPresence()
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

  /**
   * Everyone else in this document, most recently active first. The array is
   * rebuilt only when the room actually changes: this feeds
   * `useSyncExternalStore`, which compares snapshots by reference, so returning
   * a fresh array on every read makes React re-render until it gives up with
   * "Maximum update depth exceeded".
   */
  get peers() {
    return this.#peerList
  }

  #rebuildPeerList() {
    this.#peerList = [...this.#peers.values()].sort(
      (left, right) => right.updatedAt - left.updatedAt,
    )
  }

  /**
   * Reports where this person is pointing and what they have selected. Called
   * on every pointer move, so it coalesces: one request per throttle window,
   * with the last position sent on the trailing edge.
   */
  publishPresence(
    presence: Partial<{
      cursor: { x: number; y: number } | null
      selection: string[]
    }>,
  ) {
    if (this.#closed) return
    const next = {
      cursor:
        presence.cursor === undefined
          ? this.#presence.cursor
          : presence.cursor === null
            ? null
            : {
                x: Math.round(presence.cursor.x),
                y: Math.round(presence.cursor.y),
              },
      selection: presence.selection ?? this.#presence.selection,
    }
    if (
      next.cursor?.x === this.#presence.cursor?.x &&
      next.cursor?.y === this.#presence.cursor?.y &&
      (next.cursor === null) === (this.#presence.cursor === null) &&
      next.selection.join('\u0000') ===
        this.#presence.selection.join('\u0000')
    ) {
      return
    }
    this.#presence = next
    const elapsed = Date.now() - this.#presenceSentAt
    if (elapsed >= PRESENCE_THROTTLE_MS) {
      void this.#sendPresence()
      return
    }
    if (this.#presenceTimer) return
    this.#presenceTimer = setTimeout(() => {
      this.#presenceTimer = null
      void this.#sendPresence()
    }, PRESENCE_THROTTLE_MS - elapsed)
  }

  async #sendPresence(leaving = false) {
    if (this.#closed && !leaving) return
    this.#presenceSentAt = Date.now()
    const socket = this.#socket
    if (socket && socket.readyState === WebSocket.OPEN) {
      // Leaving needs no message: the service clears a peer when its socket
      // goes, which also covers the tab that never got to say goodbye.
      if (leaving) {
        this.#disconnectRealtime()
        return
      }
      try {
        socket.send(
          JSON.stringify({
            type: 'presence',
            cursor: this.#presence.cursor,
            selection: this.#presence.selection,
          }),
        )
      } catch {
        // Presence is decoration; losing a frame of it changes nothing.
      }
      return
    }
    // A socket is the transport unless this controller has fallen back to the
    // event stream. While one is being ticketed, handshaking, or waiting out a
    // retry, drop the frame rather than posting the same peer over HTTP: two
    // channels publishing one cursor is how the room ends up echoing itself.
    // The socket sends fresh presence as soon as it is ready.
    if (this.#transport !== 'sse') return
    const body = JSON.stringify({
      designId: this.target.designId,
      draftId: this.target.draftId,
      sessionId: this.#sessionId,
      cursor: this.#presence.cursor,
      selection: this.#presence.selection,
      ...(leaving ? { leaving: true } : {}),
    })
    try {
      await fetch('/api/canvas-presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: leaving,
      })
    } catch {
      // Presence is decoration; losing a frame of it changes nothing.
    }
  }

  #startPresence() {
    if (this.#presenceHeartbeat || this.#closed) return
    this.#presenceHeartbeat = setInterval(() => {
      void this.#sendPresence()
    }, PRESENCE_HEARTBEAT_MS)
    this.#presenceExpiry = setInterval(() => {
      const cutoff = Date.now() - PRESENCE_TTL_MS
      let dropped = false
      for (const [sessionId, peer] of this.#peers) {
        if (peer.updatedAt >= cutoff) continue
        this.#peers.delete(sessionId)
        dropped = true
      }
      if (dropped) {
        this.#rebuildPeerList()
        this.#emitPresence()
      }
    }, 10_000)
    void this.#sendPresence()
  }

  #stopPresence() {
    if (this.#presenceHeartbeat) clearInterval(this.#presenceHeartbeat)
    if (this.#presenceExpiry) clearInterval(this.#presenceExpiry)
    if (this.#presenceTimer) clearTimeout(this.#presenceTimer)
    this.#presenceHeartbeat = null
    this.#presenceExpiry = null
    this.#presenceTimer = null
  }

  #setPeers(peers: CanvasPeer[]) {
    let changed = false
    for (const peer of peers) {
      if (peer.sessionId === this.#sessionId) continue
      this.#peers.set(peer.sessionId, peer)
      changed = true
    }
    if (changed) {
      this.#rebuildPeerList()
      this.#emitPresence()
    }
  }

  subscribe = (listener: Listener) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /**
   * Presence has its own listeners on purpose. Cursors arrive many times a
   * second, and waking every panel in the app for each one made the editor
   * unusable — only the overlay and the face pile need to hear about them.
   */
  subscribePresence = (listener: Listener) => {
    this.#presenceListeners.add(listener)
    return () => {
      this.#presenceListeners.delete(listener)
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
      if (this.#announcedRevision > this.#revision) {
        this.#scheduleRefresh(0)
      }
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
    if (this.#activityTimer) clearTimeout(this.#activityTimer)
    if (this.#realtimeRetryTimer) clearTimeout(this.#realtimeRetryTimer)
    this.#stopPresence()
    void this.#sendPresence(true)
    this.#disconnectRealtime()
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
        if (this.#revision >= this.#announcedRevision) {
          this.#announcedRevision = this.#revision
        }
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
      if (this.#revision >= this.#announcedRevision) {
        this.#announcedRevision = this.#revision
      }
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
        this.#baseDocument = result.document
          ? parseCanvasDocument(result.document)
          : applyAcknowledgedTransactions(
              this.#baseDocument,
              batch,
              result.appliedTransactionIds,
            )
        this.#revision = result.revision
        if (this.#revision >= this.#announcedRevision) {
          this.#announcedRevision = this.#revision
        }
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
      if (this.#revision >= this.#announcedRevision) {
        this.#announcedRevision = this.#revision
      }
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

  /**
   * A socket when there is a socket service to talk to, and the server-sent
   * stream when there is not. The WebSocket carries the same events in both
   * directions, which is what lets cursors ride it instead of paying for an
   * HTTP request per pointer move.
   */
  #connectRealtime() {
    if (this.#closed || !navigator.onLine) return
    if (this.#socket || this.#eventSource) return
    if (this.#transport === 'auto' && typeof WebSocket !== 'undefined') {
      void this.#connectSocket()
      return
    }
    this.#connectEventSource()
  }

  async #connectSocket() {
    const attempt = ++this.#socketAttempt
    let ticket: { url?: unknown; ticket?: unknown } | null = null
    try {
      const response = await fetch('/api/realtime-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          designId: this.target.designId,
          draftId: this.target.draftId,
          sessionId: this.#sessionId,
        }),
      })
      // 503 is how the app says "no socket service here" — not a failure worth
      // retrying, so this controller stays on the event stream from now on.
      if (response.status === 503 || response.status === 404) {
        this.#transport = 'sse'
      }
      ticket = response.ok ? await response.json() : null
    } catch {
      ticket = null
    }
    if (this.#closed || attempt !== this.#socketAttempt) return
    if (typeof ticket?.url !== 'string' || typeof ticket.ticket !== 'string') {
      if (this.#transport === 'sse') this.#connectEventSource()
      else this.#retryRealtime()
      return
    }

    const socket = new WebSocket(
      `${ticket.url}?ticket=${encodeURIComponent(ticket.ticket)}`,
    )
    this.#socket = socket
    socket.addEventListener('message', this.#socketMessage)
    socket.addEventListener('close', this.#socketClose)
  }

  #connectEventSource() {
    if (this.#closed || this.#eventSource || typeof EventSource === 'undefined') {
      return
    }
    const url = new URL('/api/canvas-events', window.location.origin)
    url.searchParams.set('designId', this.target.designId)
    if (this.target.draftId) {
      url.searchParams.set('draftId', this.target.draftId)
    }
    const source = new EventSource(url)
    this.#eventSource = source
    source.addEventListener('open', this.#realtimeOpen)
    source.addEventListener('ready', this.#realtimeReady)
    source.addEventListener('canvas', this.#realtimeCanvas)
    source.addEventListener('error', this.#realtimeError)
  }

  #disconnectRealtime() {
    this.#realtimeConnected = false
    // A new attempt number retires any ticket fetch still in flight.
    this.#socketAttempt += 1
    const socket = this.#socket
    this.#socket = null
    if (socket) {
      socket.removeEventListener('message', this.#socketMessage)
      socket.removeEventListener('close', this.#socketClose)
      socket.close()
    }
    const source = this.#eventSource
    this.#eventSource = null
    if (!source) return
    source.removeEventListener('open', this.#realtimeOpen)
    source.removeEventListener('ready', this.#realtimeReady)
    source.removeEventListener('canvas', this.#realtimeCanvas)
    source.removeEventListener('error', this.#realtimeError)
    source.close()
  }

  #socketMessage = (message: MessageEvent) => {
    const event = parseCanvasRealtimeMessage(String(message.data))
    if (!event) return
    if (event.type === 'pong') return
    if (event.type === 'ready') {
      this.#realtimeConnected = true
      this.#socketFailures = 0
      this.#realtimeOpen()
      if (event.peers.length > 0) this.#setPeers(event.peers)
      if (event.activity) this.#setAgentActivity(event.activity)
      this.#realtimeReady()
      return
    }
    this.#applyRealtimeEvent(event)
  }

  #socketClose = (event: CloseEvent) => {
    const wasConnected = this.#realtimeConnected
    this.#disconnectRealtime()
    if (this.#closed || !navigator.onLine) return
    this.#scheduleRefresh(0)
    // 4001 is the service asking for a fresh ticket, not a failure.
    if (event.code === CLOSE_REALTIME_REAUTH) {
      this.#realtimeRetryDelay = 1_000
      this.#retryRealtime(0)
      return
    }
    if (!wasConnected) {
      this.#socketFailures += 1
      // A socket that never opens is usually a proxy in the way; the event
      // stream goes over plain HTTP and gets through.
      if (this.#socketFailures >= MAX_SOCKET_FAILURES) this.#transport = 'sse'
    }
    this.#retryRealtime()
  }

  /** Without a delay this backs off; with one it reconnects on that schedule. */
  #retryRealtime(delay?: number) {
    if (this.#closed) return
    const wait = delay ?? this.#realtimeRetryDelay
    if (delay === undefined) {
      this.#realtimeRetryDelay = Math.min(
        REALTIME_RETRY_MAX_MS,
        this.#realtimeRetryDelay * 2,
      )
    }
    if (this.#realtimeRetryTimer) clearTimeout(this.#realtimeRetryTimer)
    this.#realtimeRetryTimer = setTimeout(() => {
      this.#realtimeRetryTimer = null
      this.#connectRealtime()
    }, wait)
  }

  #realtimeOpen = () => {
    this.#realtimeConnected = true
    this.#realtimeRetryDelay = 1_000
    if (this.#realtimeRetryTimer) {
      clearTimeout(this.#realtimeRetryTimer)
      this.#realtimeRetryTimer = null
    }
    this.#scheduleRefresh(REALTIME_CONNECTED_REFRESH_MS)
  }

  #realtimeReady = () => {
    this.#scheduleRefresh(0)
    void this.#sendPresence()
  }

  #realtimeCanvas = (message: Event) => {
    if (!(message instanceof MessageEvent)) return
    const event = parseCanvasRealtimeMessage(String(message.data))
    if (event) this.#applyRealtimeEvent(event)
  }

  /** Shared by both transports: they carry exactly the same events. */
  #applyRealtimeEvent(event: CanvasRealtimeMessage) {
    if (event.type === 'ready' || event.type === 'pong') return
    if (event.type === 'agent.activity') {
      this.#setAgentActivity(event.activity)
      return
    }
    if (event.type === 'presence.state') {
      this.#setPeers(event.peers)
      return
    }
    if (event.type === 'presence.peer') {
      if (event.sessionId === this.#sessionId) return
      if (event.peer) this.#setPeers([event.peer])
      else if (this.#peers.delete(event.sessionId)) {
        this.#rebuildPeerList()
        this.#emitPresence()
      }
      return
    }
    this.#announcedRevision = Math.max(
      this.#announcedRevision,
      event.revision,
    )
    if (event.revision > this.#revision) this.#scheduleRefresh(0)
  }

  #realtimeError = () => {
    this.#disconnectRealtime()
    if (this.#closed || !navigator.onLine) return
    this.#scheduleRefresh(0)
    this.#retryRealtime()
  }

  #scheduleRefresh(delay: number) {
    if (this.#closed) return
    if (this.#refreshTimer) clearTimeout(this.#refreshTimer)
    this.#refreshTimer = setTimeout(() => {
      this.#refreshTimer = null
      void this.refresh().finally(() => {
        this.#scheduleRefresh(
          document.visibilityState === 'hidden'
            ? REALTIME_CONNECTED_REFRESH_MS
            : this.#realtimeConnected
              ? REALTIME_CONNECTED_REFRESH_MS
              : REALTIME_DISCONNECTED_REFRESH_MS,
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
      current?.expiresAt === activity?.expiresAt &&
      current?.label === activity?.label &&
      current?.nodeIds.join('\u0000') === activity?.nodeIds.join('\u0000')
    ) {
      return
    }
    if (this.#activityTimer) {
      clearTimeout(this.#activityTimer)
      this.#activityTimer = null
    }
    this.#agentActivity = activity
      ? { ...activity, nodeIds: [...activity.nodeIds] }
      : null
    if (activity) {
      // Both timestamps come from the server, so their difference is the real
      // lifetime even when this machine's clock disagrees. `expiresAt` is
      // trusted only when it lands inside that window.
      const fallbackTtl = activity.phase === 'settled' ? 8_000 : 30_000
      const ttl = activity.expiresAt
        ? Math.max(0, activity.expiresAt - activity.updatedAt)
        : fallbackTtl
      const remaining = activity.expiresAt ? activity.expiresAt - Date.now() : 0
      this.#activityTimer = setTimeout(
        () => {
          this.#activityTimer = null
          this.#setAgentActivity(null)
        },
        remaining > 0 && remaining <= ttl ? remaining : ttl,
      )
    }
    // Agent activity rides the presence channel: it now changes on every tool
    // call, and waking every panel in the editor for that is the same mistake
    // cursors used to make.
    this.#emitPresence()
  }

  #online = () => {
    if (this.#status === 'offline') this.#status = 'ready'
    this.#emit()
    this.#schedule(0)
    this.#connectRealtime()
    this.#scheduleRefresh(0)
  }

  #offline = () => {
    if (this.#realtimeRetryTimer) {
      clearTimeout(this.#realtimeRetryTimer)
      this.#realtimeRetryTimer = null
    }
    this.#disconnectRealtime()
    this.#status = 'offline'
    this.#emit()
  }

  #pageHide = () => {
    void writePending(targetKey(this.target), this.#pending)
    void this.#sendPresence(true)
    void this.flush()
  }

  #visibilityChange = () => {
    if (document.visibilityState === 'visible') {
      this.#connectRealtime()
      this.#scheduleRefresh(0)
    }
  }

  #emit() {
    for (const listener of this.#listeners) listener()
  }

  #emitPresence() {
    for (const listener of this.#presenceListeners) listener()
  }
}
