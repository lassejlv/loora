import type { Server } from 'bun'
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
import { Connections, type SocketData } from './connections'
import { createCounters, type Counters } from './counters'
import { RealtimeHub } from './hub'
import { createInternalHttp, json } from './internal-http'
import { createRateLimiter, parseClientMessage } from './protocol'

export { CLOSE_TOO_MANY, MAX_SOCKETS_PER_USER } from './connections'
export type { SocketData } from './connections'

/** A tab that ignores the limit is misbehaving, not merely busy. */
const CLIENT_MESSAGE_LIMIT = 60
const CLIENT_MESSAGE_WINDOW_MS = 1_000
const MAX_SOCKET_PAYLOAD_BYTES = 16 * 1024
/** Sockets are checked for expiry on this cadence, not per message. */
const SWEEP_INTERVAL_MS = 30_000
/** Closing with 4001 tells the client to re-ticket and reconnect at once. */
export const CLOSE_REAUTH = 4001
const CLOSE_GOING_AWAY = 1012

/**
 * The subprotocol a client offers alongside its ticket. A browser cannot set
 * headers on a WebSocket, and a query string is the one part of a request that
 * proxies and edge logs are most likely to keep, so the ticket travels as the
 * second offered subprotocol instead. The query form stays supported for
 * clients running a bundle from before this existed.
 */
const TICKET_PROTOCOL = 'loora.realtime.v1'

/**
 * The session a presence frame is about, or `null` for anything else.
 *
 * Presence is the one event a client also sends, so its author already knows
 * what it says. The substring check keeps the common path — canvas changes and
 * agent activity — from paying for a parse.
 */
export function presenceAuthor(payload: string) {
  if (!payload.includes('"presence.peer"')) return null
  try {
    const parsed = JSON.parse(payload) as { type?: unknown; sessionId?: unknown }
    return parsed.type === 'presence.peer' && typeof parsed.sessionId === 'string'
      ? parsed.sessionId
      : null
  } catch {
    return null
  }
}

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
  counters: Counters
  connections: Connections
  stop: () => Promise<void>
}

export function createRealtimeService(config: WsConfig): RealtimeService {
  const counters = createCounters()
  const connections = new Connections(counters)
  const bus = createBus(config.redisUrl)
  const hub = new RealtimeHub(bus, (channel, payload) => {
    // Everything else goes out through Bun's topic fan-out. A presence frame
    // walks the room instead so its author can be skipped: a cursor at frame
    // rate would otherwise spend a message per move telling a tab what it just
    // said. Only the instance holding that socket finds a match, so the rest of
    // the room is unaffected.
    const author = presenceAuthor(payload)
    if (author === null) {
      server.publish(channel, payload)
      return
    }
    for (const socket of connections.room(channel)) {
      if (socket.data.claims.sessionId === author) continue
      socket.send(payload)
    }
  })
  const internal = createInternalHttp(hub, counters, config.internalToken)

  const originAllowed = (request: Request) => {
    const origin = request.headers.get('origin')
    if (!origin || !config.allowedOrigins) return true
    return config.allowedOrigins.includes(origin)
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

  async function handleUpgrade(
    request: Request,
    url: URL,
    server: Server<SocketData>,
  ) {
    if (!originAllowed(request)) {
      counters.count('originRefused')
      return new Response('Forbidden origin', { status: 403 })
    }
    const { ticket, protocol } = ticketFromRequest(request, url)
    const claims = await verifyRealtimeTicket(ticket, config.ticketSecrets)
    if (!claims) {
      counters.count('ticketInvalid')
      return new Response('Invalid ticket', { status: 401 })
    }
    // Spend the ticket. A second connection on the same one is a replay, not a
    // reconnect: the client asks the web app for a fresh ticket every time it
    // opens a socket.
    let claimed = false
    try {
      claimed = await bus.claimTicket(
        claims.jti,
        claims.expiresAt - Date.now() + 5_000,
      )
    } catch {
      console.error('[loora-ws] could not claim ticket')
    }
    if (!claimed) {
      counters.count('ticketReplayed')
      return new Response('Ticket already used', { status: 401 })
    }

    const upgraded = server.upgrade(request, {
      headers: protocol ? { 'Sec-WebSocket-Protocol': protocol } : undefined,
      data: {
        channel: hub.channelFor(claims.ownerUserId, {
          designId: claims.designId,
          draftId: claims.draftId,
        }),
        claims,
        closeAt: Date.now() + REALTIME_CONNECTION_TTL_MS,
        allow: createRateLimiter(CLIENT_MESSAGE_LIMIT, CLIENT_MESSAGE_WINDOW_MS),
      } satisfies SocketData,
    })
    return upgraded
      ? undefined
      : new Response('Expected a WebSocket upgrade', { status: 426 })
  }

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
          sockets: connections.size,
          rooms: hub.roomCount,
          rejections: counters.snapshot(),
        })
      }

      // Liveness says the process is up; readiness says the room is still
      // shared. Without the bus this instance keeps serving sockets that can no
      // longer see each other, which is worth failing a check over.
      if (request.method === 'GET' && url.pathname === '/ready') {
        const ready = await bus.ping()
        return json({ service: 'ws', ready, bus: bus.kind }, ready ? 200 : 503)
      }

      if (request.method === 'POST' && url.pathname === '/publish') {
        return internal.publish(request)
      }

      if (request.method === 'POST' && url.pathname === '/state') {
        return internal.state(request)
      }

      if (url.pathname === '/canvas') return handleUpgrade(request, url, server)

      return json({ error: 'Not found' }, 404)
    },
    websocket: {
      maxPayloadLength: MAX_SOCKET_PAYLOAD_BYTES,
      async open(ws) {
        connections.add(ws)
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
        if (!ws.data.allow()) {
          counters.count('messagesDropped')
          return
        }
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
        connections.remove(ws)
        ws.unsubscribe(ws.data.channel)
        await hub.clearPresence(ws.data.channel, ws.data.claims.sessionId)
        await hub.leave(ws.data.channel)
      },
    },
  })

  const sweeper = setInterval(() => {
    for (const socket of connections.expired(Date.now())) {
      socket.close(CLOSE_REAUTH, 'Ticket expired')
    }
  }, SWEEP_INTERVAL_MS)
  // A background sweep should never be the reason the process stays alive.
  sweeper.unref?.()

  return {
    server,
    hub,
    bus,
    counters,
    connections,
    stop: async () => {
      clearInterval(sweeper)
      // Take these peers out of the room before the bus goes: a socket's own
      // close handler runs too late to reach Redis, and without this the tabs
      // still connected elsewhere would draw ghosts until the entries expire.
      await Promise.all(
        [...connections.all].map((socket) =>
          hub
            .clearPresence(socket.data.channel, socket.data.claims.sessionId)
            .catch(() => undefined),
        ),
      )
      for (const socket of connections.all) {
        socket.close(CLOSE_GOING_AWAY, 'Restarting')
      }
      bus.close()
      await server.stop(true)
    },
  }
}
