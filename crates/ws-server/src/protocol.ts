import {
  isCanvasPresencePeer,
  isCanvasRealtimeActivity,
  normalizePresenceInput,
  type CanvasPresencePeer,
  type CanvasRealtimeActivity,
  type CanvasRealtimeEventInput,
  type CanvasRealtimeTarget,
} from '@loora/realtime/events'

export const TICKET_PROTOCOL = 'loora.realtime.v1'
export const CONNECTION_TTL_MS = 15 * 60_000
export const CONNECTION_IDLE_TTL_MS = 120_000
export const MAX_SOCKET_PAYLOAD = 16 * 1024
export const MAX_INGEST_BYTES = 64 * 1024
export const CLIENT_MESSAGE_LIMIT = 60
export const CLIENT_MESSAGE_WINDOW_MS = 1_000
export const INGEST_LIMIT = 6_000
export const INGEST_WINDOW_MS = 60_000
export const MAX_SOCKETS_PER_USER = 20

export type ClientMessage =
  | { type: 'ping' }
  | {
      type: 'presence'
      cursor: { x: number; y: number } | null
      selection: string[]
    }

export type IngestMessage =
  | {
      kind: 'event'
      ownerUserId: string
      target: CanvasRealtimeTarget
      event: CanvasRealtimeEventInput
    }
  | {
      kind: 'activity'
      ownerUserId: string
      target: CanvasRealtimeTarget
      activity: CanvasRealtimeActivity | null
    }
  | {
      kind: 'presence'
      ownerUserId: string
      target: CanvasRealtimeTarget
      peer: CanvasPresencePeer
    }
  | {
      kind: 'presence.clear'
      ownerUserId: string
      target: CanvasRealtimeTarget
      sessionId: string
    }

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function nodeIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 64 &&
    value.every((id) => text(id, 128))
  )
}

function parseTarget(value: unknown): CanvasRealtimeTarget | null {
  if (!record(value) || typeof value.designId !== 'string') return null
  const designId = value.designId.trim()
  if (!text(designId, 128)) return null
  const draftId =
    typeof value.draftId === 'string' && value.draftId.trim()
      ? value.draftId.trim()
      : null
  if (draftId !== null && !text(draftId, 128)) return null
  return { designId, draftId }
}

function parseEvent(value: unknown): CanvasRealtimeEventInput | null {
  if (!record(value)) return null
  if (
    value.type === 'canvas.changed' &&
    Number.isInteger(value.revision) &&
    Number(value.revision) >= 0 &&
    nodeIds(value.nodeIds)
  ) {
    return {
      type: 'canvas.changed',
      revision: Number(value.revision),
      nodeIds: value.nodeIds,
    }
  }
  if (
    value.type === 'branch.changed' &&
    (value.draftId === null || text(value.draftId, 128)) &&
    (value.status === null || typeof value.status === 'string')
  ) {
    return {
      type: 'branch.changed',
      draftId: value.draftId,
      status: value.status,
    }
  }
  return null
}

export function parseClientMessage(raw: string): ClientMessage | null {
  if (new TextEncoder().encode(raw).byteLength > MAX_SOCKET_PAYLOAD) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!record(value)) return null
  if (value.type === 'ping') return { type: 'ping' }
  if (value.type !== 'presence') return null
  const normalized = normalizePresenceInput(value)
  return normalized ? { type: 'presence', ...normalized } : null
}

export function parseIngestMessage(value: unknown): IngestMessage | null {
  if (!record(value) || !text(value.ownerUserId, 128)) return null
  const target = parseTarget(value.target)
  if (!target) return null
  if (value.kind === 'event') {
    const event = parseEvent(value.event)
    return event
      ? { kind: 'event', ownerUserId: value.ownerUserId, target, event }
      : null
  }
  if (
    value.kind === 'activity' &&
    (value.activity === null || isCanvasRealtimeActivity(value.activity))
  ) {
    return {
      kind: 'activity',
      ownerUserId: value.ownerUserId,
      target,
      activity: value.activity,
    }
  }
  if (value.kind === 'presence' && isCanvasPresencePeer(value.peer)) {
    return {
      kind: 'presence',
      ownerUserId: value.ownerUserId,
      target,
      peer: value.peer,
    }
  }
  if (value.kind === 'presence.clear' && text(value.sessionId, 128)) {
    return {
      kind: 'presence.clear',
      ownerUserId: value.ownerUserId,
      target,
      sessionId: value.sessionId,
    }
  }
  return null
}

export function parseStateRequest(
  value: unknown,
): { ownerUserId: string; target: CanvasRealtimeTarget } | null {
  if (!record(value) || !text(value.ownerUserId, 128)) return null
  const target = parseTarget(value.target)
  return target ? { ownerUserId: value.ownerUserId, target } : null
}

export function offeredProtocols(request: Request) {
  return (request.headers.get('Sec-WebSocket-Protocol') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

export function ticketFromRequest(request: Request) {
  const offered = offeredProtocols(request)
  const ticket =
    offered.find((value) => value !== TICKET_PROTOCOL) ??
    new URL(request.url).searchParams.get('ticket') ??
    ''
  return { offered, ticket }
}

export function allowedOrigins(raw: string | undefined) {
  if (!raw?.trim()) return null
  const origins = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value).origin
      } catch {
        return value
      }
    })
  return origins.length ? origins : null
}

export function originAllowed(request: Request, allowed: string[] | null) {
  const origin = request.headers.get('Origin')
  return !origin || !allowed || allowed.includes(origin)
}

export function withSentAt<T extends Record<string, unknown>>(event: T) {
  return JSON.stringify({ ...event, sentAt: Date.now() })
}
