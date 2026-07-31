import { timingSafeEqual } from 'node:crypto'
import type { Counters } from './counters'
import type { RealtimeHub } from './hub'
import { createRateLimiter, parseIngestMessage, parseStateRequest } from './protocol'

/**
 * The service-to-service surface: `/publish` and `/state`, called by the web app
 * and the MCP server with the shared internal token. Everything a browser
 * touches lives on the socket instead.
 */

/**
 * Publishes arrive from every editor and every MCP tool call, so the ceiling
 * has to sit above a busy day without leaving a loop unbounded. A publisher
 * that is turned away falls back to Redis, so this degrades rather than drops.
 */
const INGEST_LIMIT = 6_000
const INGEST_WINDOW_MS = 60_000
/** An ingest body is a cursor or a revision, never a document. */
const MAX_INGEST_BYTES = 64 * 1024

export function json(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
) {
  return Response.json(body, { status, headers })
}

export interface InternalHttp {
  publish: (request: Request) => Promise<Response>
  state: (request: Request) => Promise<Response>
}

export function createInternalHttp(
  hub: RealtimeHub,
  counters: Counters,
  internalToken: string,
): InternalHttp {
  const allowed = createRateLimiter(INGEST_LIMIT, INGEST_WINDOW_MS)

  const authorized = (request: Request) => {
    const header = request.headers.get('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    const expected = Buffer.from(internalToken)
    const provided = Buffer.from(token)
    return (
      provided.length === expected.length && timingSafeEqual(provided, expected)
    )
  }

  /** Token, size, then rate — cheapest check first. */
  const guard = (request: Request) => {
    if (!authorized(request)) {
      counters.count('ingestUnauthorized')
      return json({ error: 'Unauthorized' }, 401)
    }
    const declared = Number(request.headers.get('content-length') ?? 0)
    if (Number.isFinite(declared) && declared > MAX_INGEST_BYTES) {
      counters.count('ingestInvalid')
      return json({ error: 'Payload too large' }, 413)
    }
    if (!allowed()) {
      counters.count('ingestThrottled')
      return json({ error: 'Too many requests' }, 429, { 'Retry-After': '1' })
    }
    return null
  }

  const body = async (request: Request) => {
    try {
      return { ok: true as const, value: (await request.json()) as unknown }
    } catch {
      counters.count('ingestInvalid')
      return { ok: false as const, response: json({ error: 'Invalid JSON' }, 400) }
    }
  }

  return {
    async publish(request) {
      const refused = guard(request)
      if (refused) return refused
      const parsed = await body(request)
      if (!parsed.ok) return parsed.response

      const message = parseIngestMessage(parsed.value)
      if (!message) {
        counters.count('ingestInvalid')
        return json({ error: 'Invalid realtime message' }, 400)
      }

      const channel = hub.channelFor(message.ownerUserId, message.target)
      const published =
        message.kind === 'event'
          ? await hub.publishEvent(channel, message.event)
          : message.kind === 'activity'
            ? await hub.publishActivity(channel, message.activity)
            : message.kind === 'presence'
              ? await hub.publishPresence(channel, message.peer)
              : await hub.clearPresence(channel, message.sessionId)

      return published
        ? json({ published: true })
        : json({ error: 'Could not publish' }, 503)
    },

    async state(request) {
      const refused = guard(request)
      if (refused) return refused
      const parsed = await body(request)
      if (!parsed.ok) return parsed.response

      const requested = parseStateRequest(parsed.value)
      if (!requested) {
        counters.count('ingestInvalid')
        return json({ error: 'Invalid state request' }, 400)
      }
      return json(
        await hub.readState(
          hub.channelFor(requested.ownerUserId, requested.target),
        ),
      )
    },
  }
}
