/**
 * The service-to-service door into realtime.
 *
 * Web request handlers and the MCP server produce events; the WebSocket service
 * owns the room state and the Redis bus. Posting through this client means a
 * publisher only needs one HTTP endpoint and a shared token — not a Redis URL
 * of its own, which is exactly the configuration that used to fail silently on
 * whichever service was missing it.
 */

import type {
  CanvasPresencePeer,
  CanvasRealtimeActivity,
  CanvasRealtimeEventInput,
  CanvasRealtimeTarget,
} from './events'

export type RealtimeIngestMessage =
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

export interface RealtimeRoomState {
  peers: CanvasPresencePeer[]
  activity: CanvasRealtimeActivity | null
}

export interface RealtimeIngestConfig {
  url: string
  token: string
}

/** Publishes are best effort and sit in front of user-facing work. */
const INGEST_TIMEOUT_MS = 2_000

export function realtimeIngestConfig(
  env: Record<string, string | undefined> = process.env,
): RealtimeIngestConfig | null {
  const url = env.REALTIME_INGEST_URL?.trim()
  const token = env.REALTIME_INTERNAL_TOKEN?.trim()
  if (!url || !token) return null
  return { url: url.replace(/\/+$/, ''), token }
}

async function post(
  config: RealtimeIngestConfig,
  path: string,
  body: unknown,
): Promise<Response | null> {
  try {
    const response = await fetch(`${config.url}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(INGEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      // Drain the body so the connection can be reused.
      void response.arrayBuffer().catch(() => undefined)
      return null
    }
    return response
  } catch {
    return null
  }
}

/** `false` means the caller should fall back to publishing on Redis itself. */
export async function sendRealtimeIngest(
  message: RealtimeIngestMessage,
  config = realtimeIngestConfig(),
) {
  if (!config) return false
  return (await post(config, '/publish', message)) !== null
}

/** The room as it stands, for a tab that just opened. */
export async function readRealtimeRoomState(
  ownerUserId: string,
  target: CanvasRealtimeTarget,
  config = realtimeIngestConfig(),
): Promise<RealtimeRoomState | null> {
  if (!config) return null
  const response = await post(config, '/state', { ownerUserId, target })
  if (!response) return null
  try {
    const body = (await response.json()) as unknown
    if (!body || typeof body !== 'object') return null
    const state = body as Partial<RealtimeRoomState>
    return {
      peers: Array.isArray(state.peers) ? state.peers : [],
      activity: state.activity ?? null,
    }
  } catch {
    return null
  }
}
