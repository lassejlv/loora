import { timingSafeEqual } from 'node:crypto'
import type { Server, ServerWebSocket } from 'bun'
import {
  MAX_PRESENCE_PEERS,
  type CanvasPresencePeer,
} from '@loora/realtime/events'
import {
  REALTIME_CONNECTION_TTL_MS,
  verifyRealtimeTicket,
  type RealtimeTicketClaims,
} from '@loora/realtime/ticket'
import { createBus, type RealtimeBus } from './bus'
import type { WsConfig } from './config'
import { RealtimeHub } from './hub'
import {
  createRateLimiter,
  parseClientMessage,
  parseIngestMessage,
  parseStateRequest,
} from './protocol'

export interface SocketData {
  channel: string
  claims: RealtimeTicketClaims
  /** When this socket must re-authenticate with a fresh ticket. */
  closeAt: number
  allow: (now?: number) => boolean
}

/** A tab that ignores the limit is misbehaving, not merely busy. */
const CLIENT_MESSAGE_LIMIT = 60
const CLIENT_MESSAGE_WINDOW_MS = 1_000
const MAX_SOCKET_PAYLOAD_BYTES = 16 * 1024
/** Sockets are checked for expiry on this cadence, not per message. */
const SWEEP_INTERVAL_MS = 30_000
/** Closing with 4001 tells the client to re-ticket and reconnect at once. */
export const CLOSE_REAUTH = 4001
/** One account, many tabs — but not unbounded. The oldest socket gives way. */
export const CLOSE_TOO_MANY = 4002
export const MAX_SOCKETS_PER_USER = 20
const CLOSE_GOING_AWAY = 1012

/**
 * The subprotocol a client offers alongside its ticket. A browser cannot set
 * headers on a WebSocket, and a query string is the one part of a request that
 * proxies and edge logs are most likely to keep, so the ticket travels as the
 * second offered subprotocol instead. The query form stays supported for
 * clients running a bundle from before this existed.
 */
const TICKET_PROTOCOL = 'loora.realtime.v1'

export function ticketFromRequest(request: Request, url: URL) {
  const offered = (request.headers.get('sec-websocket-protocol') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  const fromProtocol = offered.find((entry) => entry !== TICKET_PROTOCOL)
  return {
    ticket: fromProtocol ?? url.searchParams.get('ticket') ?? '',
    /** Echoed back only when the client actually asked for the protocol. */
    protocol: offered.includes(TICKET_PROTOCOL) ? TICKET_PROTOCOL : null,
  }
}

export interface RealtimeService {
  server: Server<SocketData>
  hub: RealtimeHub
  bus: RealtimeBus
  sockets: Set<ServerWebSocket<SocketData>>
  stop: () => Promise<void>
}

export function createRealtimeService(config: WsConfig): RealtimeService {
  const sockets = new Set<ServerWebSocket<SocketData>>()
  const byUser = new Map<string, Set<ServerWebSocket<SocketData>>>()
  const bus = createBus(config.redisUrl)
  const hub = new RealtimeHub(bus, (channel, payload) => {
    server.publish(channel, payload)
  })

  const json = (body: unknown, status = 200) => Response.json(body, { status })

  const authorized = (request: Request) => {
    const header = request.headers.get('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    const expected = Buffer.from(config.internalToken)
    const provided = Buffer.from(token)
    return (
      provided.length === expected.length && timingSafeEqual(provided, expected)
    )
  }

  const originAllowed = (request: Request) => {
    const origin = request.headers.get('origin')
    if (!origin || !config.allowedOrigins) return true
    return config.allowedOrigins.includes(origin)
  }

  async function handlePublish(request: Request) {
    if (!authorized(request)) return json({ error: 'Unauthorized' }, 401)
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return json({ error: 'Invalid JSON' }, 400)
    }
    const message = parseIngestMessage(body)
    if (!message) return json({ error: 'Invalid realtime message' }, 400)

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
  }

  async function handleState(request: Request) {
    if (!authorized(request)) return json({ error: 'Unauthorized' }, 401)
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return json({ error: 'Invalid JSON' }, 400)
    }
    const requested = parseStateRequest(body)
    if (!requested) return json({ error: 'Invalid state request' }, 400)
    return json(
      await hub.readState(
        hub.channelFor(requested.ownerUserId, requested.target),
      ),
    )
  }

  // Identity comes from the ticket, never from the socket payload: a client can
  // say where it is pointing, not who it is or what it may do.
  const peerFrom = (
    claims: RealtimeTicketClaims,
    cursor: CanvasPresencePeer['cursor'],
    selection: string[],
  ): CanvasPresencePeer => ({
    sessionId: claims.sessionId,
    userId: claims.userId,
    name: claims.name,
    image: claims.image,
    color: claims.color,
    role: claims.role,
    cursor,
    selection,
    updatedAt: Date.now(),
  })

  const server = Bun.serve<SocketData>({
    port: config.port,
    hostname: '0.0.0.0',
    // Presence heartbeats arrive well inside this, so an idle socket here is a
    // socket whose tab is gone.
    idleTimeout: 120,
    async fetch(request, server) {
      const url = new URL(request.url)

      if (
        request.method === 'GET' &&
        (url.pathname === '/' || url.pathname === '/health')
      ) {
        return json({
          name: 'loora-ws',
          bus: bus.kind,
          sockets: sockets.size,
          rooms: hub.roomCount,
        })
      }

      if (request.method === 'GET' && url.pathname === '/ready') {
        return json({ service: 'ws', ready: true, bus: bus.kind })
      }

      if (request.method === 'POST' && url.pathname === '/publish') {
        return handlePublish(request)
      }

      if (request.method === 'POST' && url.pathname === '/state') {
        return handleState(request)
      }

      if (url.pathname === '/canvas') {
        if (!originAllowed(request)) {
          return new Response('Forbidden origin', { status: 403 })
        }
        const { ticket, protocol } = ticketFromRequest(request, url)
        const claims = await verifyRealtimeTicket(ticket, config.ticketSecret)
        if (!claims) return new Response('Invalid ticket', { status: 401 })
        // Spend the ticket. A second connection on the same one is a replay,
        // not a reconnect: the client asks the web app for a fresh ticket every
        // time it opens a socket.
        let claimed = false
        try {
          claimed = await bus.claimTicket(
            claims.jti,
            claims.expiresAt - Date.now() + 5_000,
          )
        } catch {
          console.error('[loora-ws] could not claim ticket')
        }
        if (!claimed) return new Response('Ticket already used', { status: 401 })
        const upgraded = server.upgrade(request, {
          headers: protocol ? { 'Sec-WebSocket-Protocol': protocol } : undefined,
          data: {
            channel: hub.channelFor(claims.ownerUserId, {
              designId: claims.designId,
              draftId: claims.draftId,
            }),
            claims,
            closeAt: Date.now() + REALTIME_CONNECTION_TTL_MS,
            allow: createRateLimiter(
              CLIENT_MESSAGE_LIMIT,
              CLIENT_MESSAGE_WINDOW_MS,
            ),
          } satisfies SocketData,
        })
        return upgraded
          ? undefined
          : new Response('Expected a WebSocket upgrade', { status: 426 })
      }

      return json({ error: 'Not found' }, 404)
    },
    websocket: {
      maxPayloadLength: MAX_SOCKET_PAYLOAD_BYTES,
      async open(ws) {
        sockets.add(ws)
        // One account should not be able to hold the service open with an
        // unbounded number of sockets. The newest tab is the one somebody is
        // looking at, so the oldest gives way rather than the arriving one.
        const mine = byUser.get(ws.data.claims.userId) ?? new Set()
        mine.add(ws)
        byUser.set(ws.data.claims.userId, mine)
        if (mine.size > MAX_SOCKETS_PER_USER) {
          for (const oldest of mine) {
            if (mine.size <= MAX_SOCKETS_PER_USER) break
            mine.delete(oldest)
            oldest.close(CLOSE_TOO_MANY, 'Too many connections')
          }
        }
        ws.subscribe(ws.data.channel)
        try {
          await hub.join(ws.data.channel)
        } catch {
          console.error('[loora-ws] could not join', ws.data.channel)
          ws.close(1011, 'Room unavailable')
          return
        }
        // Whoever is already in the room, and any agent already mid-run, so a
        // tab that just opened is not blank until the next event.
        const state = await hub.readState(ws.data.channel)
        ws.send(
          JSON.stringify({
            type: 'ready',
            sessionId: ws.data.claims.sessionId,
            role: ws.data.claims.role,
            peers: state.peers.slice(0, MAX_PRESENCE_PEERS),
            activity: state.activity,
            sentAt: Date.now(),
          }),
        )
      },
      async message(ws, raw) {
        if (!ws.data.allow()) return
        const message = parseClientMessage(
          typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8'),
        )
        if (!message) return
        if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', sentAt: Date.now() }))
          return
        }
        await hub.publishPresence(
          ws.data.channel,
          peerFrom(ws.data.claims, message.cursor, message.selection),
        )
      },
      async close(ws) {
        sockets.delete(ws)
        const mine = byUser.get(ws.data.claims.userId)
        if (mine) {
          mine.delete(ws)
          if (mine.size === 0) byUser.delete(ws.data.claims.userId)
        }
        ws.unsubscribe(ws.data.channel)
        await hub.clearPresence(ws.data.channel, ws.data.claims.sessionId)
        await hub.leave(ws.data.channel)
      },
    },
  })

  const sweeper = setInterval(() => {
    const now = Date.now()
    for (const ws of sockets) {
      if (ws.data.closeAt <= now) ws.close(CLOSE_REAUTH, 'Ticket expired')
    }
  }, SWEEP_INTERVAL_MS)
  // A background sweep should never be the reason the process stays alive.
  sweeper.unref?.()

  return {
    server,
    hub,
    bus,
    sockets,
    stop: async () => {
      clearInterval(sweeper)
      for (const ws of sockets) ws.close(CLOSE_GOING_AWAY, 'Restarting')
      bus.close()
      await server.stop(true)
    },
  }
}
