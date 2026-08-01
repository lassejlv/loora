import {
  isCanvasPresencePeer,
  isCanvasRealtimeActivity,
  normalizePresenceInput,
  type CanvasRealtimeEventInput,
  type CanvasRealtimeTarget,
} from '@loora/realtime/events'
import type { RealtimeIngestMessage } from '@loora/realtime/ingest'

/**
 * What a browser is allowed to say.
 *
 * A connected client can move its cursor, change its selection, and prove it is
 * still there. It cannot publish canvas changes or agent activity over the
 * socket — those come from the server side through `POST /publish`, where the
 * caller holds the internal token.
 */
export type ClientMessage =
  | { type: 'presence'; cursor: { x: number; y: number } | null; selection: string[] }
  | { type: 'ping' }

export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > 8_192) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const message = parsed as Record<string, unknown>
  if (message.type === 'ping') return { type: 'ping' }
  if (message.type !== 'presence') return null
  const presence = normalizePresenceInput(message)
  if (!presence) return null
  return { type: 'presence', ...presence }
}

function target(value: unknown): CanvasRealtimeTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const designId = typeof raw.designId === 'string' ? raw.designId.trim() : ''
  if (designId.length === 0 || designId.length > 128) return null
  const draftId =
    typeof raw.draftId === 'string' && raw.draftId.trim().length > 0
      ? raw.draftId.trim()
      : null
  if (draftId && draftId.length > 128) return null
  return { designId, draftId }
}

function ownerUserId(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
    ? value
    : null
}

function eventInput(value: unknown): CanvasRealtimeEventInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  // `canvas.changed` is the only event a publisher sends as itself; presence and
  // activity have their own kinds so the room state is written with them.
  if (
    raw.type === 'canvas.changed' &&
    Number.isInteger(raw.revision) &&
    Number(raw.revision) >= 0 &&
    Array.isArray(raw.nodeIds) &&
    raw.nodeIds.length <= 64 &&
    raw.nodeIds.every(
      (id) => typeof id === 'string' && id.length > 0 && id.length <= 128,
    )
  ) {
    return {
      type: 'canvas.changed',
      revision: Number(raw.revision),
      nodeIds: raw.nodeIds as string[],
    }
  }
  if (
    raw.type === 'branch.changed' &&
    (raw.draftId === null ||
      (typeof raw.draftId === 'string' &&
        raw.draftId.length > 0 &&
        raw.draftId.length <= 128)) &&
    (raw.status === null || typeof raw.status === 'string')
  ) {
    return {
      type: 'branch.changed',
      draftId: raw.draftId as string | null,
      status: raw.status === null ? null : String(raw.status),
    }
  }
  return null
}

/** Validates a `POST /publish` body from another Loora service. */
export function parseIngestMessage(value: unknown): RealtimeIngestMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const owner = ownerUserId(raw.ownerUserId)
  const where = target(raw.target)
  if (!owner || !where) return null

  if (raw.kind === 'event') {
    const event = eventInput(raw.event)
    return event
      ? { kind: 'event', ownerUserId: owner, target: where, event }
      : null
  }
  if (raw.kind === 'activity') {
    if (raw.activity === null) {
      return { kind: 'activity', ownerUserId: owner, target: where, activity: null }
    }
    return isCanvasRealtimeActivity(raw.activity)
      ? {
          kind: 'activity',
          ownerUserId: owner,
          target: where,
          activity: raw.activity,
        }
      : null
  }
  if (raw.kind === 'presence') {
    return isCanvasPresencePeer(raw.peer)
      ? { kind: 'presence', ownerUserId: owner, target: where, peer: raw.peer }
      : null
  }
  if (raw.kind === 'presence.clear') {
    const sessionId =
      typeof raw.sessionId === 'string' &&
      raw.sessionId.length > 0 &&
      raw.sessionId.length <= 128
        ? raw.sessionId
        : null
    return sessionId
      ? { kind: 'presence.clear', ownerUserId: owner, target: where, sessionId }
      : null
  }
  return null
}

export function parseStateRequest(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const owner = ownerUserId(raw.ownerUserId)
  const where = target(raw.target)
  return owner && where ? { ownerUserId: owner, target: where } : null
}

/**
 * A cursor that moves at frame rate is already throttled by the client; this is
 * the backstop for one that is not, and it is per socket so a noisy tab cannot
 * spend anyone else's budget.
 */
export function createRateLimiter(limit: number, windowMs: number) {
  let windowStartedAt = 0
  let used = 0
  return (now = Date.now()) => {
    if (now - windowStartedAt >= windowMs) {
      windowStartedAt = now
      used = 0
    }
    used += 1
    return used <= limit
  }
}
