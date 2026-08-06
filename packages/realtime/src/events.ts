/**
 * The realtime wire protocol, with no transport in it.
 *
 * Every side of realtime speaks these shapes: the WebSocket service that fans
 * them out, the web app that renders them, the MCP server that emits them, and
 * the Redis bus that carries them between service instances. Keeping the
 * definitions here — free of database, auth, and canvas imports — is what lets
 * the Rust socket service stay a small process that never opens a database connection.
 */

export interface CanvasRealtimeTarget {
  designId: string
  draftId?: string | null
}

export interface CanvasRealtimeActivity {
  id: string
  label: string
  nodeIds: string[]
  phase: 'working' | 'settled'
  updatedAt: number
  expiresAt: number
}

/**
 * Somebody else looking at the same document. Identity is filled in on the
 * server from the session; a client only ever supplies where its pointer is and
 * what it has selected, so a peer cannot claim to be another person.
 */
export interface CanvasPresencePeer {
  sessionId: string
  userId: string
  name: string
  image: string | null
  color: string
  role: 'owner' | 'edit' | 'view'
  /** Scene coordinates, so every viewer places it under their own camera. */
  cursor: { x: number; y: number } | null
  selection: string[]
  updatedAt: number
}

export type CanvasRealtimeEvent =
  | {
      type: 'canvas.changed'
      revision: number
      nodeIds: string[]
      sentAt: number
    }
  | {
      type: 'agent.activity'
      activity: CanvasRealtimeActivity | null
      sentAt: number
    }
  | {
      type: 'presence.peer'
      sessionId: string
      peer: CanvasPresencePeer | null
      sentAt: number
    }
  | {
      type: 'presence.state'
      peers: CanvasPresencePeer[]
      sentAt: number
    }
  | {
      type: 'branch.changed'
      draftId: string | null
      status: string | null
      sentAt: number
    }

export type CanvasRealtimeEventInput =
  | Omit<Extract<CanvasRealtimeEvent, { type: 'canvas.changed' }>, 'sentAt'>
  | Omit<Extract<CanvasRealtimeEvent, { type: 'agent.activity' }>, 'sentAt'>
  | Omit<Extract<CanvasRealtimeEvent, { type: 'presence.peer' }>, 'sentAt'>
  | Omit<Extract<CanvasRealtimeEvent, { type: 'presence.state' }>, 'sentAt'>
  | Omit<Extract<CanvasRealtimeEvent, { type: 'branch.changed' }>, 'sentAt'>

/**
 * The channel a document's events travel on. Keyed by the owner rather than the
 * viewer, so guests in a shared design land in the same room as the owner.
 */
export function canvasRealtimeChannel(
  userId: string,
  target: CanvasRealtimeTarget,
) {
  return [
    'loora',
    'canvas',
    encodeURIComponent(userId),
    encodeURIComponent(target.designId),
    encodeURIComponent(
      target.draftId ? `draft:${target.draftId}` : 'main',
    ),
  ].join(':')
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function nodeIds(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length <= 64 &&
    value.every(
      (id) => typeof id === 'string' && id.length > 0 && id.length <= 128,
    )
  )
}

function stringArray(value: unknown): string[] | null {
  if (!nodeIds(value) || !Array.isArray(value)) return null
  return value.filter((id): id is string => typeof id === 'string')
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function isCanvasRealtimeActivity(
  value: unknown,
): value is CanvasRealtimeActivity {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.id.length <= 200 &&
    typeof value.label === 'string' &&
    value.label.length > 0 &&
    value.label.length <= 160 &&
    nodeIds(value.nodeIds) &&
    (value.phase === 'working' || value.phase === 'settled') &&
    Number.isFinite(value.updatedAt) &&
    Number.isFinite(value.expiresAt)
  )
}

export const MAX_PRESENCE_PEERS = 50
export const PRESENCE_TTL_MS = 45_000
export const MAX_PRESENCE_SELECTION = 64

/** A tool call is running. Long enough to cover a slow render. */
export const AGENT_ACTIVITY_WORKING_TTL_MS = 30_000
/** The gap between two tool calls, so the badge does not blink per call. */
export const AGENT_ACTIVITY_SETTLED_TTL_MS = 8_000

export function isCanvasPresencePeer(
  value: unknown,
): value is CanvasPresencePeer {
  return (
    record(value) &&
    typeof value.sessionId === 'string' &&
    value.sessionId.length > 0 &&
    value.sessionId.length <= 128 &&
    typeof value.userId === 'string' &&
    value.userId.length > 0 &&
    value.userId.length <= 128 &&
    typeof value.name === 'string' &&
    value.name.length <= 200 &&
    (value.image === null || typeof value.image === 'string') &&
    typeof value.color === 'string' &&
    /^#[0-9a-f]{6}$/i.test(value.color) &&
    (value.role === 'owner' || value.role === 'edit' || value.role === 'view') &&
    (value.cursor === null ||
      (record(value.cursor) &&
        Number.isFinite(value.cursor.x) &&
        Number.isFinite(value.cursor.y))) &&
    nodeIds(value.selection) &&
    Number.isFinite(value.updatedAt)
  )
}

export function parseCanvasRealtimeEvent(
  value: string,
): CanvasRealtimeEvent | null {
  if (value.length > 100_000) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (
    !record(parsed) ||
    !Number.isFinite(parsed.sentAt)
  ) {
    return null
  }
  const sentAt = finiteNumber(parsed.sentAt)
  if (sentAt === null) return null
  if (
    parsed.type === 'canvas.changed' &&
    Number.isInteger(parsed.revision) &&
    Number(parsed.revision) >= 0
  ) {
    const revision = finiteNumber(parsed.revision)
    const nodeIdsValue = stringArray(parsed.nodeIds)
    if (revision === null || nodeIdsValue === null) return null
    return {
      type: 'canvas.changed',
      revision,
      nodeIds: nodeIdsValue,
      sentAt,
    }
  }
  if (
    parsed.type === 'agent.activity' &&
    (parsed.activity === null || isCanvasRealtimeActivity(parsed.activity))
  ) {
    return {
      type: 'agent.activity',
      activity: parsed.activity,
      sentAt,
    }
  }
  if (
    parsed.type === 'presence.peer' &&
    typeof parsed.sessionId === 'string' &&
    parsed.sessionId.length > 0 &&
    parsed.sessionId.length <= 128 &&
    (parsed.peer === null || isCanvasPresencePeer(parsed.peer))
  ) {
    return {
      type: 'presence.peer',
      sessionId: stringValue(parsed.sessionId) ?? '',
      peer: parsed.peer,
      sentAt,
    }
  }
  if (
    parsed.type === 'presence.state' &&
    Array.isArray(parsed.peers) &&
    parsed.peers.length <= MAX_PRESENCE_PEERS &&
    parsed.peers.every(isCanvasPresencePeer)
  ) {
    return {
      type: 'presence.state',
      peers: parsed.peers.filter(isCanvasPresencePeer),
      sentAt,
    }
  }
  if (
    parsed.type === 'branch.changed' &&
    (parsed.draftId === null ||
      (typeof parsed.draftId === 'string' &&
        parsed.draftId.length > 0 &&
        parsed.draftId.length <= 128)) &&
    (parsed.status === null || typeof parsed.status === 'string')
  ) {
    return {
      type: 'branch.changed',
      draftId: parsed.draftId === null ? null : stringValue(parsed.draftId),
      status: parsed.status === null ? null : stringValue(parsed.status),
      sentAt,
    }
  }
  return null
}

/** Stable per person, so the same collaborator keeps the same colour. */
const PRESENCE_COLORS = [
  '#6c5ce7',
  '#e056fd',
  '#00b894',
  '#0984e3',
  '#e17055',
  '#fdcb6e',
  '#e84393',
  '#00cec9',
]

export function presenceColor(userId: string) {
  let hash = 2166136261
  for (let index = 0; index < userId.length; index += 1) {
    hash ^= userId.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return PRESENCE_COLORS[(hash >>> 0) % PRESENCE_COLORS.length]!
}

/**
 * The key a peer occupies in a room.
 *
 * A client picks the tab half; the account owns the rest. Without that scoping
 * anyone with access to a design could claim a peer's key and overwrite — or on
 * disconnect, clear — somebody else's cursor.
 */
export function scopePresenceSessionId(userId: string, clientId: string) {
  return `${userId.slice(0, 64)}:${clientId.slice(0, 63)}`
}

export function isPresenceFresh(peer: CanvasPresencePeer, now: number) {
  return now - peer.updatedAt < PRESENCE_TTL_MS
}

/** Trim a presence payload that a client sent to what the room accepts. */
export function normalizePresenceInput(value: unknown) {
  if (!record(value)) return null
  const cursor =
    record(value.cursor) &&
    typeof value.cursor.x === 'number' &&
    typeof value.cursor.y === 'number' &&
    Number.isFinite(value.cursor.x) &&
    Number.isFinite(value.cursor.y) &&
    Math.abs(value.cursor.x) < 1e7 &&
    Math.abs(value.cursor.y) < 1e7
      ? { x: Math.round(value.cursor.x), y: Math.round(value.cursor.y) }
      : null
  const selection = Array.isArray(value.selection)
    ? value.selection
        .filter(
          (id): id is string =>
            typeof id === 'string' && id.length > 0 && id.length <= 128,
        )
        .slice(0, MAX_PRESENCE_SELECTION)
    : []
  return { cursor, selection }
}
