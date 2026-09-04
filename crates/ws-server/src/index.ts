import { DurableObject } from 'cloudflare:workers'
import {
  canvasRealtimeChannel,
  isCanvasPresencePeer,
  isCanvasRealtimeActivity,
  isPresenceFresh,
  MAX_PRESENCE_PEERS,
  PRESENCE_TTL_MS,
  type CanvasPresencePeer,
  type CanvasRealtimeActivity,
  type CanvasRealtimeEventInput,
  type CanvasRealtimeTarget,
} from '@loora/realtime/events'
import {
  verifyRealtimeTicket,
  type RealtimeTicketClaims,
} from '@loora/realtime/ticket'
import {
  allowedOrigins,
  CLIENT_MESSAGE_LIMIT,
  CLIENT_MESSAGE_WINDOW_MS,
  CONNECTION_TTL_MS,
  INGEST_LIMIT,
  INGEST_WINDOW_MS,
  MAX_INGEST_BYTES,
  MAX_SOCKET_PAYLOAD,
  MAX_SOCKETS_PER_USER,
  originAllowed,
  parseClientMessage,
  parseIngestMessage,
  parseStateRequest,
  ticketFromRequest,
  TICKET_PROTOCOL,
  withSentAt,
  type IngestMessage,
} from './protocol'

type RealtimeEnv = Env

type CounterName =
  | 'ticketInvalid'
  | 'ticketReplayed'
  | 'originRefused'
  | 'ingestUnauthorized'
  | 'ingestInvalid'
  | 'ingestThrottled'
  | 'messagesDropped'
  | 'socketsEvicted'

const COUNTERS: CounterName[] = [
  'ticketInvalid',
  'ticketReplayed',
  'originRefused',
  'ingestUnauthorized',
  'ingestInvalid',
  'ingestThrottled',
  'messagesDropped',
  'socketsEvicted',
]

const encoder = new TextEncoder()
const INTERNAL_CLAIMS_HEADER = 'X-Loora-Realtime-Claims'
const INTERNAL_PROTOCOL_HEADER = 'X-Loora-Realtime-Protocol'

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function isTicketClaims(value: unknown): value is RealtimeTicketClaims {
  if (!record(value)) return false
  return (
    value.v === 1 &&
    nonEmptyText(value.jti, 128) &&
    nonEmptyText(value.userId, 128) &&
    nonEmptyText(value.sessionId, 128) &&
    nonEmptyText(value.ownerUserId, 128) &&
    nonEmptyText(value.designId, 128) &&
    (value.draftId === null || nonEmptyText(value.draftId, 128)) &&
    (value.role === 'owner' || value.role === 'edit' || value.role === 'view') &&
    nonEmptyText(value.name, 200) &&
    (value.image === null || nonEmptyText(value.image, 1_000)) &&
    typeof value.color === 'string' &&
    /^#[0-9a-f]{6}$/i.test(value.color) &&
    typeof value.issuedAt === 'number' &&
    Number.isFinite(value.issuedAt) &&
    typeof value.expiresAt === 'number' &&
    Number.isFinite(value.expiresAt)
  )
}

function encodeClaims(claims: RealtimeTicketClaims) {
  return encodeURIComponent(JSON.stringify(claims))
}

function decodeClaims(request: Request): RealtimeTicketClaims | null {
  const value = request.headers.get(INTERNAL_CLAIMS_HEADER)
  if (!value) return null
  try {
    const claims: unknown = JSON.parse(decodeURIComponent(value))
    return isTicketClaims(claims) ? claims : null
  } catch {
    return null
  }
}

function ticketSecrets(env: RealtimeEnv) {
  const current = env.REALTIME_TICKET_SECRET?.trim()
  if (!current || current.length < 32) return null
  const previous = env.REALTIME_TICKET_SECRET_PREVIOUS?.trim()
  return previous && previous !== current ? [current, previous] : [current]
}

function internalToken(env: RealtimeEnv) {
  const token = env.REALTIME_INTERNAL_TOKEN?.trim()
  return token && token.length >= 32 ? token : null
}

async function secureEqual(provided: string, expected: string) {
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ])
  return crypto.subtle.timingSafeEqual(providedHash, expectedHash)
}

function structuredLog(
  level: 'info' | 'warn' | 'error',
  message: string,
  details: Record<string, unknown> = {},
) {
  const entry = JSON.stringify({ level, message, ...details })
  if (level === 'error') console.error(entry)
  else if (level === 'warn') console.warn(entry)
  else console.log(entry)
}

function errorJson(status: number, message: string, headers?: HeadersInit) {
  return Response.json({ error: message }, { status, headers })
}

async function hashName(kind: 'room' | 'user', value: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', encoder.encode(value)),
  )
  let encoded = ''
  for (const byte of digest) encoded += byte.toString(16).padStart(2, '0')
  return `${kind}:${encoded}`
}

export async function roomObjectName(
  ownerUserId: string,
  target: CanvasRealtimeTarget,
) {
  return hashName('room', canvasRealtimeChannel(ownerUserId, target))
}

async function userObjectName(userId: string) {
  return hashName('user', userId)
}

type LimitedJson =
  | { ok: true; value: unknown }
  | { ok: false; tooLarge: boolean }

async function readLimitedJson(
  request: Request,
  limit: number,
): Promise<LimitedJson> {
  const declared = Number(request.headers.get('Content-Length') ?? 0)
  if (Number.isFinite(declared) && declared > limit) {
    return { ok: false, tooLarge: true }
  }
  if (!request.body) return { ok: false, tooLarge: false }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit) {
        await reader.cancel()
        return { ok: false, tooLarge: true }
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return {
      ok: true,
      value: JSON.parse(
        new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
          bytes,
        ),
      ),
    }
  } catch {
    return { ok: false, tooLarge: false }
  } finally {
    reader.releaseLock()
  }
}

function ingress(env: RealtimeEnv) {
  return env.REALTIME_INGRESS.getByName('global')
}

async function recordCounter(env: RealtimeEnv, name: CounterName) {
  try {
    await ingress(env).recordCounter(name)
  } catch (error) {
    structuredLog('error', 'counter write failed', {
      counter: name,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function handleHealth(env: RealtimeEnv) {
  const secretsReady = ticketSecrets(env) !== null && internalToken(env) !== null
  let rejections: Record<string, number> = {}
  try {
    rejections = await ingress(env).counterSnapshot()
  } catch (error) {
    structuredLog('error', 'health check failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return Response.json(
      { name: 'loora-ws', ready: false, coordinator: 'durable-objects' },
      { status: 503 },
    )
  }
  return Response.json({
    name: 'loora-ws',
    bus: 'durable-objects',
    ready: secretsReady,
    rejections,
  })
}

async function handleReady(env: RealtimeEnv) {
  const configured = ticketSecrets(env) !== null && internalToken(env) !== null
  if (!configured) {
    return Response.json(
      { service: 'ws', ready: false, bus: 'durable-objects' },
      { status: 503 },
    )
  }
  try {
    await ingress(env).ping()
    return Response.json({ service: 'ws', ready: true, bus: 'durable-objects' })
  } catch {
    return Response.json(
      { service: 'ws', ready: false, bus: 'durable-objects' },
      { status: 503 },
    )
  }
}

async function authorizeIngest(request: Request, env: RealtimeEnv) {
  const expected = internalToken(env)
  if (!expected) return errorJson(503, 'Realtime service is not configured')
  const header = request.headers.get('Authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!(await secureEqual(provided, expected))) {
    await recordCounter(env, 'ingestUnauthorized')
    return errorJson(401, 'Unauthorized')
  }
  if (!(await ingress(env).allowIngest(Date.now()))) {
    await recordCounter(env, 'ingestThrottled')
    return errorJson(429, 'Too many requests', { 'Retry-After': '1' })
  }
  return null
}

async function handlePublish(request: Request, env: RealtimeEnv) {
  const denied = await authorizeIngest(request, env)
  if (denied) return denied
  const body = await readLimitedJson(request, MAX_INGEST_BYTES)
  if (!body.ok) {
    await recordCounter(env, 'ingestInvalid')
    return errorJson(
      body.tooLarge ? 413 : 400,
      body.tooLarge ? 'Payload too large' : 'Invalid JSON',
    )
  }
  const message = parseIngestMessage(body.value)
  if (!message) {
    await recordCounter(env, 'ingestInvalid')
    return errorJson(400, 'Invalid realtime message')
  }
  const room = env.REALTIME_ROOMS.getByName(
    await roomObjectName(message.ownerUserId, message.target),
  )
  await publishToRoom(room, message)
  return Response.json({ published: true })
}

async function publishToRoom(
  room: DurableObjectStub<RealtimeRoom>,
  message: IngestMessage,
) {
  if (message.kind === 'event') return room.publishEvent(message.event)
  if (message.kind === 'activity') return room.publishActivity(message.activity)
  if (message.kind === 'presence') return room.publishPresence(message.peer)
  return room.clearPresence(message.sessionId)
}

async function handleState(request: Request, env: RealtimeEnv) {
  const denied = await authorizeIngest(request, env)
  if (denied) return denied
  const body = await readLimitedJson(request, MAX_INGEST_BYTES)
  if (!body.ok) {
    await recordCounter(env, 'ingestInvalid')
    return errorJson(
      body.tooLarge ? 413 : 400,
      body.tooLarge ? 'Payload too large' : 'Invalid JSON',
    )
  }
  const stateRequest = parseStateRequest(body.value)
  if (!stateRequest) {
    await recordCounter(env, 'ingestInvalid')
    return errorJson(400, 'Invalid state request')
  }
  const room = env.REALTIME_ROOMS.getByName(
    await roomObjectName(stateRequest.ownerUserId, stateRequest.target),
  )
  return Response.json(await room.roomState())
}

async function handleCanvas(request: Request, env: RealtimeEnv) {
  const origins = allowedOrigins(
    env.REALTIME_ALLOWED_ORIGINS ?? env.BETTER_AUTH_URL,
  )
  if (!originAllowed(request, origins)) {
    await recordCounter(env, 'originRefused')
    return new Response('Forbidden origin', { status: 403 })
  }
  const secrets = ticketSecrets(env)
  if (!secrets) return new Response('Realtime service is not configured', { status: 503 })
  const { offered, ticket } = ticketFromRequest(request)
  const claims = await verifyRealtimeTicket(ticket, secrets)
  if (!claims) {
    await recordCounter(env, 'ticketInvalid')
    return new Response('Invalid ticket', { status: 401 })
  }
  const headers = new Headers(request.headers)
  headers.set(INTERNAL_CLAIMS_HEADER, encodeClaims(claims))
  headers.set(
    INTERNAL_PROTOCOL_HEADER,
    offered.includes(TICKET_PROTOCOL) ? '1' : '0',
  )
  if (offered.includes(TICKET_PROTOCOL)) {
    headers.set('Sec-WebSocket-Protocol', TICKET_PROTOCOL)
  } else {
    headers.delete('Sec-WebSocket-Protocol')
  }
  const url = new URL(request.url)
  url.search = ''
  const internalRequest = new Request(url, {
    method: 'GET',
    headers,
  })
  const room = env.REALTIME_ROOMS.getByName(
    await roomObjectName(claims.ownerUserId, {
      designId: claims.designId,
      draftId: claims.draftId,
    }),
  )
  return room.fetch(internalRequest)
}

export default {
  async fetch(request: Request, env: RealtimeEnv): Promise<Response> {
    const url = new URL(request.url)
    try {
      if ((url.pathname === '/' || url.pathname === '/health') && request.method === 'GET') {
        return await handleHealth(env)
      }
      if (url.pathname === '/ready' && request.method === 'GET') {
        return await handleReady(env)
      }
      if (url.pathname === '/publish' && request.method === 'POST') {
        return await handlePublish(request, env)
      }
      if (url.pathname === '/state' && request.method === 'POST') {
        return await handleState(request, env)
      }
      if (url.pathname === '/canvas') return await handleCanvas(request, env)
      return new Response('Not found', { status: 404 })
    } catch (error) {
      structuredLog('error', 'request failed', {
        method: request.method,
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      })
      return errorJson(500, 'Internal server error')
    }
  },
} satisfies ExportedHandler<RealtimeEnv>

export class RealtimeIngress extends DurableObject<RealtimeEnv> {
  constructor(ctx: DurableObjectState, env: RealtimeEnv) {
    super(ctx, env)
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS ingest_rate (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        window_started_at INTEGER NOT NULL,
        used INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS counters (
        name TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      );
    `)
  }

  allowIngest(now: number) {
    return this.ctx.storage.transactionSync(() => {
      const current = this.ctx.storage.sql
        .exec<{ window_started_at: number; used: number }>(
          'SELECT window_started_at, used FROM ingest_rate WHERE singleton = 1',
        )
        .toArray()[0]
      const resetWindow =
        !current || now - current.window_started_at >= INGEST_WINDOW_MS
      const windowStartedAt = resetWindow ? now : current.window_started_at
      const used = resetWindow ? 1 : current.used + 1
      this.ctx.storage.sql.exec(
        `INSERT INTO ingest_rate (singleton, window_started_at, used)
         VALUES (1, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           window_started_at = excluded.window_started_at,
           used = excluded.used`,
        windowStartedAt,
        used,
      )
      return used <= INGEST_LIMIT
    })
  }

  recordCounter(name: string) {
    if (!COUNTERS.includes(name as CounterName)) return
    this.ctx.storage.sql.exec(
      `INSERT INTO counters (name, value) VALUES (?, 1)
       ON CONFLICT(name) DO UPDATE SET value = value + 1`,
      name,
    )
  }

  counterSnapshot() {
    const rows = this.ctx.storage.sql
      .exec<{ name: string; value: number }>('SELECT name, value FROM counters')
      .toArray()
    const snapshot: Record<string, number> = {}
    for (const name of COUNTERS) snapshot[name] = 0
    for (const row of rows) snapshot[row.name] = row.value
    return snapshot
  }

  ping() {
    return true
  }
}

export interface ConnectionClaim {
  jti: string
  ticketExpiresAt: number
  connection: {
    id: string
    roomName: string
    connectedAt: number
    expiresAt: number
  } | null
}

interface EvictedConnection extends Record<string, SqlStorageValue> {
  connection_id: string
  room_name: string
}

export class RealtimeUser extends DurableObject<RealtimeEnv> {
  constructor(ctx: DurableObjectState, env: RealtimeEnv) {
    super(ctx, env)
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS ticket_claims (
        jti TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS connections (
        connection_id TEXT PRIMARY KEY,
        room_name TEXT NOT NULL,
        connected_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS connections_by_age
        ON connections (connected_at, connection_id);
    `)
  }

  async claimAndReserve(input: ConnectionClaim) {
    const now = Date.now()
    if (
      !nonEmptyText(input.jti, 128) ||
      !Number.isFinite(input.ticketExpiresAt) ||
      (input.connection !== null &&
        (!nonEmptyText(input.connection.id, 128) ||
          !nonEmptyText(input.connection.roomName, 128) ||
          !Number.isFinite(input.connection.connectedAt) ||
          !Number.isFinite(input.connection.expiresAt)))
    ) {
      throw new Error('Invalid connection claim')
    }
    const result = this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        'DELETE FROM ticket_claims WHERE expires_at <= ?',
        now,
      )
      this.ctx.storage.sql.exec(
        'DELETE FROM connections WHERE expires_at <= ?',
        now,
      )
      const replayed = this.ctx.storage.sql
        .exec<{ found: number }>(
          'SELECT 1 AS found FROM ticket_claims WHERE jti = ? LIMIT 1',
          input.jti,
        )
        .toArray().length > 0
      if (replayed) return { replayed: true, evicted: [] as EvictedConnection[] }
      this.ctx.storage.sql.exec(
        'INSERT INTO ticket_claims (jti, expires_at) VALUES (?, ?)',
        input.jti,
        Math.max(now + 1_000, input.ticketExpiresAt),
      )
      if (!input.connection) {
        return { replayed: false, evicted: [] as EvictedConnection[] }
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO connections
          (connection_id, room_name, connected_at, expires_at)
         VALUES (?, ?, ?, ?)`,
        input.connection.id,
        input.connection.roomName,
        input.connection.connectedAt,
        input.connection.expiresAt,
      )
      const count = this.ctx.storage.sql
        .exec<{ count: number }>('SELECT COUNT(*) AS count FROM connections')
        .one().count
      const evicted =
        count > MAX_SOCKETS_PER_USER
          ? this.ctx.storage.sql
              .exec<EvictedConnection>(
                `SELECT connection_id, room_name FROM connections
                 ORDER BY connected_at, connection_id
                 LIMIT ?`,
                count - MAX_SOCKETS_PER_USER,
              )
              .toArray()
          : []
      for (const connection of evicted) {
        this.ctx.storage.sql.exec(
          'DELETE FROM connections WHERE connection_id = ?',
          connection.connection_id,
        )
      }
      return { replayed: false, evicted }
    })
    await this.scheduleAlarm()
    if (result.evicted.length) {
      const operations: Promise<unknown>[] = result.evicted.map((connection) =>
        this.env.REALTIME_ROOMS
          .getByName(connection.room_name)
          .evictConnection(connection.connection_id),
      )
      operations.push(
        this.env.REALTIME_INGRESS
          .getByName('global')
          .recordCounter('socketsEvicted'),
      )
      await Promise.allSettled(operations)
    }
    return { accepted: !result.replayed, replayed: result.replayed }
  }

  async releaseConnection(connectionId: string) {
    if (!nonEmptyText(connectionId, 128)) return
    this.ctx.storage.sql.exec(
      'DELETE FROM connections WHERE connection_id = ?',
      connectionId,
    )
    await this.scheduleAlarm()
  }

  async alarm() {
    const now = Date.now()
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        'DELETE FROM ticket_claims WHERE expires_at <= ?',
        now,
      )
      this.ctx.storage.sql.exec(
        'DELETE FROM connections WHERE expires_at <= ?',
        now,
      )
    })
    await this.scheduleAlarm()
  }

  private async scheduleAlarm() {
    const next = this.ctx.storage.sql
      .exec<{ expires_at: number | null }>(
        `SELECT MIN(expires_at) AS expires_at FROM (
          SELECT expires_at FROM ticket_claims
          UNION ALL
          SELECT expires_at FROM connections
        )`,
      )
      .one().expires_at
    if (next === null) {
      await this.ctx.storage.deleteAlarm()
      return
    }
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 1_000, next))
  }
}

interface SocketIdentity {
  v: 1
  connectionId: string
  userId: string
  sessionId: string
  role: 'owner' | 'edit' | 'view'
  name: string
  image: string | null
  color: string
  expiresAt: number
  rateWindowStartedAt: number
  rateUsed: number
  cleaned: boolean
}

function isSocketIdentity(value: unknown): value is SocketIdentity {
  if (!record(value)) return false
  return (
    value.v === 1 &&
    nonEmptyText(value.connectionId, 128) &&
    nonEmptyText(value.userId, 128) &&
    nonEmptyText(value.sessionId, 128) &&
    (value.role === 'owner' || value.role === 'edit' || value.role === 'view') &&
    typeof value.name === 'string' &&
    value.name.length <= 200 &&
    (value.image === null || typeof value.image === 'string') &&
    typeof value.color === 'string' &&
    typeof value.expiresAt === 'number' &&
    Number.isFinite(value.expiresAt) &&
    typeof value.rateWindowStartedAt === 'number' &&
    Number.isFinite(value.rateWindowStartedAt) &&
    typeof value.rateUsed === 'number' &&
    Number.isInteger(value.rateUsed) &&
    typeof value.cleaned === 'boolean'
  )
}

function socketIdentity(socket: WebSocket) {
  const attachment: unknown = socket.deserializeAttachment()
  return isSocketIdentity(attachment) ? attachment : null
}

function closeSocket(socket: WebSocket, code: number, reason: string) {
  try {
    socket.close(code, reason)
  } catch {
    // A socket may already be closed when its close/error handlers race.
  }
}

export class RealtimeRoom extends DurableObject<RealtimeEnv> {
  constructor(ctx: DurableObjectState, env: RealtimeEnv) {
    super(ctx, env)
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS presence (
        session_id TEXT PRIMARY KEY,
        peer TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS activity (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        value TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `)
  }

  async fetch(request: Request): Promise<Response> {
    const claims = decodeClaims(request)
    const roomName = this.ctx.id.name
    if (!claims || !roomName || claims.expiresAt <= Date.now()) {
      return new Response('Invalid ticket', { status: 401 })
    }
    const upgrade = request.headers.get('Upgrade')?.toLowerCase() === 'websocket'
    const connectionId = upgrade ? crypto.randomUUID() : null
    const user = this.env.REALTIME_USERS.getByName(
      await userObjectName(claims.userId),
    )
    const reservation = await user.claimAndReserve({
      jti: claims.jti,
      ticketExpiresAt: claims.expiresAt + 5_000,
      connection: connectionId
        ? {
            id: connectionId,
            roomName,
            connectedAt: Date.now(),
            expiresAt: Date.now() + CONNECTION_TTL_MS,
          }
        : null,
    })
    if (reservation.replayed) {
      await this.env.REALTIME_INGRESS
        .getByName('global')
        .recordCounter('ticketReplayed')
      return new Response('Ticket already used', { status: 401 })
    }
    if (!upgrade || !connectionId) {
      return new Response('Expected a WebSocket upgrade', { status: 426 })
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    server.binaryType = 'arraybuffer'
    const now = Date.now()
    const identity: SocketIdentity = {
      v: 1,
      connectionId,
      userId: claims.userId,
      sessionId: claims.sessionId,
      role: claims.role,
      name: claims.name,
      image: claims.image,
      color: claims.color,
      expiresAt: now + CONNECTION_TTL_MS,
      rateWindowStartedAt: now,
      rateUsed: 0,
      cleaned: false,
    }
    server.serializeAttachment(identity)
    this.ctx.acceptWebSocket(server)
    const state = this.readRoomState(now)
    try {
      server.send(
        JSON.stringify({
          type: 'ready',
          sessionId: claims.sessionId,
          role: claims.role,
          peers: state.peers,
          activity: state.activity,
          sentAt: now,
        }),
      )
      await this.scheduleAlarm()
    } catch (error) {
      await this.cleanupSocket(server)
      closeSocket(server, 1011, 'Could not open connection')
      structuredLog('error', 'socket setup failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    const headers = new Headers()
    if (request.headers.get(INTERNAL_PROTOCOL_HEADER) === '1') {
      headers.set('Sec-WebSocket-Protocol', TICKET_PROTOCOL)
    }
    return new Response(null, { status: 101, webSocket: client, headers })
  }

  async publishEvent(event: CanvasRealtimeEventInput) {
    await this.broadcast(withSentAt(event))
  }

  async publishActivity(activity: CanvasRealtimeActivity | null) {
    if (activity) {
      this.ctx.storage.sql.exec(
        `INSERT INTO activity (singleton, value, expires_at)
         VALUES (1, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           value = excluded.value,
           expires_at = excluded.expires_at`,
        JSON.stringify(activity),
        activity.expiresAt,
      )
    } else {
      this.ctx.storage.sql.exec('DELETE FROM activity WHERE singleton = 1')
    }
    await this.broadcast(
      withSentAt({ type: 'agent.activity', activity }),
    )
    await this.scheduleAlarm()
  }

  async publishPresence(peer: CanvasPresencePeer) {
    if (!isCanvasPresencePeer(peer)) throw new Error('Invalid presence peer')
    this.writePresence(peer)
    await this.broadcast(
      withSentAt({
        type: 'presence.peer',
        sessionId: peer.sessionId,
        peer,
      }),
      peer.sessionId,
    )
    await this.scheduleAlarm()
  }

  async clearPresence(sessionId: string) {
    if (!nonEmptyText(sessionId, 128)) throw new Error('Invalid session id')
    this.ctx.storage.sql.exec(
      'DELETE FROM presence WHERE session_id = ?',
      sessionId,
    )
    await this.broadcast(
      withSentAt({ type: 'presence.peer', sessionId, peer: null }),
      sessionId,
    )
    await this.scheduleAlarm()
  }

  roomState() {
    return this.readRoomState(Date.now())
  }

  async evictConnection(connectionId: string) {
    if (!nonEmptyText(connectionId, 128)) return
    for (const socket of this.ctx.getWebSockets()) {
      const identity = socketIdentity(socket)
      if (identity?.connectionId === connectionId) {
        await this.cleanupSocket(socket)
        closeSocket(socket, 4002, 'Too many connections')
        return
      }
    }
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    const identity = socketIdentity(socket)
    if (!identity || identity.cleaned) {
      closeSocket(socket, 1011, 'Invalid connection state')
      return
    }
    const size =
      typeof message === 'string'
        ? encoder.encode(message).byteLength
        : message.byteLength
    if (size > MAX_SOCKET_PAYLOAD) {
      await this.cleanupSocket(socket)
      closeSocket(socket, 1009, 'Message too large')
      return
    }
    const now = Date.now()
    if (now - identity.rateWindowStartedAt >= CLIENT_MESSAGE_WINDOW_MS) {
      identity.rateWindowStartedAt = now
      identity.rateUsed = 0
    }
    identity.rateUsed += 1
    socket.serializeAttachment(identity)
    if (identity.rateUsed > CLIENT_MESSAGE_LIMIT) {
      await this.env.REALTIME_INGRESS
        .getByName('global')
        .recordCounter('messagesDropped')
      return
    }
    let raw: string
    try {
      raw =
        typeof message === 'string'
          ? message
          : new TextDecoder('utf-8', {
              fatal: true,
              ignoreBOM: false,
            }).decode(message)
    } catch {
      return
    }
    const parsed = parseClientMessage(raw)
    if (!parsed) return
    if (parsed.type === 'ping') {
      socket.send(JSON.stringify({ type: 'pong', sentAt: now }))
      return
    }
    const peer: CanvasPresencePeer = {
      sessionId: identity.sessionId,
      userId: identity.userId,
      name: identity.name,
      image: identity.image,
      color: identity.color,
      role: identity.role,
      cursor: parsed.cursor,
      selection: parsed.selection,
      updatedAt: now,
    }
    this.writePresence(peer)
    await this.broadcast(
      withSentAt({
        type: 'presence.peer',
        sessionId: identity.sessionId,
        peer,
      }),
      identity.sessionId,
    )
    await this.scheduleAlarm()
  }

  async webSocketClose(socket: WebSocket) {
    await this.cleanupSocket(socket)
  }

  async webSocketError(socket: WebSocket, error: unknown) {
    structuredLog('error', 'socket error', {
      error: error instanceof Error ? error.message : String(error),
    })
    await this.cleanupSocket(socket)
    closeSocket(socket, 1011, 'WebSocket error')
  }

  async alarm() {
    const now = Date.now()
    for (const socket of this.ctx.getWebSockets()) {
      const identity = socketIdentity(socket)
      if (!identity || identity.expiresAt <= now) {
        await this.cleanupSocket(socket)
        closeSocket(socket, 4001, 'Ticket expired')
      }
    }

    const staleSessions = this.ctx.storage.sql
      .exec<{ session_id: string }>(
        'SELECT session_id FROM presence WHERE updated_at <= ?',
        now - PRESENCE_TTL_MS,
      )
      .toArray()
    this.ctx.storage.sql.exec(
      'DELETE FROM presence WHERE updated_at <= ?',
      now - PRESENCE_TTL_MS,
    )
    for (const { session_id: sessionId } of staleSessions) {
      await this.broadcast(
        withSentAt({ type: 'presence.peer', sessionId, peer: null }),
        sessionId,
      )
    }

    const expiredActivity = this.ctx.storage.sql
      .exec<{ found: number }>(
        'SELECT 1 AS found FROM activity WHERE singleton = 1 AND expires_at <= ?',
        now,
      )
      .toArray().length > 0
    if (expiredActivity) {
      this.ctx.storage.sql.exec(
        'DELETE FROM activity WHERE singleton = 1 AND expires_at <= ?',
        now,
      )
      await this.broadcast(
        withSentAt({ type: 'agent.activity', activity: null }),
      )
    }
    await this.scheduleAlarm()
  }

  private writePresence(peer: CanvasPresencePeer) {
    this.ctx.storage.sql.exec(
      `INSERT INTO presence (session_id, peer, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         peer = excluded.peer,
         updated_at = excluded.updated_at`,
      peer.sessionId,
      JSON.stringify(peer),
      peer.updatedAt,
    )
  }

  private readRoomState(now: number) {
    this.ctx.storage.sql.exec(
      'DELETE FROM presence WHERE updated_at <= ?',
      now - PRESENCE_TTL_MS,
    )
    this.ctx.storage.sql.exec(
      'DELETE FROM activity WHERE singleton = 1 AND expires_at <= ?',
      now,
    )
    const peers: CanvasPresencePeer[] = []
    const rows = this.ctx.storage.sql
      .exec<{ peer: string }>(
        'SELECT peer FROM presence ORDER BY updated_at DESC LIMIT ?',
        MAX_PRESENCE_PEERS,
      )
      .toArray()
    for (const row of rows) {
      try {
        const peer: unknown = JSON.parse(row.peer)
        if (isCanvasPresencePeer(peer) && isPresenceFresh(peer, now)) {
          peers.push(peer)
        }
      } catch {
        // Ignore corrupt ephemeral state and keep serving the room.
      }
    }
    const activityRow = this.ctx.storage.sql
      .exec<{ value: string }>(
        'SELECT value FROM activity WHERE singleton = 1 LIMIT 1',
      )
      .toArray()[0]
    let activity: CanvasRealtimeActivity | null = null
    if (activityRow) {
      try {
        const parsed: unknown = JSON.parse(activityRow.value)
        if (isCanvasRealtimeActivity(parsed) && parsed.expiresAt > now) {
          activity = parsed
        }
      } catch {
        // Ignore corrupt ephemeral state and keep serving the room.
      }
    }
    return { peers, activity }
  }

  private async broadcast(payload: string, excludedSessionId?: string) {
    for (const socket of this.ctx.getWebSockets()) {
      const identity = socketIdentity(socket)
      if (
        !identity ||
        identity.cleaned ||
        identity.sessionId === excludedSessionId
      ) {
        continue
      }
      try {
        socket.send(payload)
      } catch {
        closeSocket(socket, 1011, 'Could not deliver message')
      }
    }
  }

  private async cleanupSocket(socket: WebSocket) {
    const identity = socketIdentity(socket)
    if (!identity || identity.cleaned) return
    identity.cleaned = true
    socket.serializeAttachment(identity)
    this.ctx.storage.sql.exec(
      'DELETE FROM presence WHERE session_id = ?',
      identity.sessionId,
    )
    await this.broadcast(
      withSentAt({
        type: 'presence.peer',
        sessionId: identity.sessionId,
        peer: null,
      }),
      identity.sessionId,
    )
    await this.env.REALTIME_USERS
      .getByName(await userObjectName(identity.userId))
      .releaseConnection(identity.connectionId)
    await this.scheduleAlarm()
  }

  private async scheduleAlarm() {
    const deadlines = this.ctx
      .getWebSockets()
      .map(socketIdentity)
      .filter((value): value is SocketIdentity => value !== null && !value.cleaned)
      .map((identity) => identity.expiresAt)
    const presence = this.ctx.storage.sql
      .exec<{ deadline: number | null }>(
        'SELECT MIN(updated_at) + ? AS deadline FROM presence',
        PRESENCE_TTL_MS,
      )
      .one().deadline
    const activity = this.ctx.storage.sql
      .exec<{ deadline: number | null }>(
        'SELECT MIN(expires_at) AS deadline FROM activity',
      )
      .one().deadline
    if (presence !== null) deadlines.push(presence)
    if (activity !== null) deadlines.push(activity)
    if (!deadlines.length) {
      await this.ctx.storage.deleteAlarm()
      return
    }
    const next = Math.max(Date.now() + 1_000, Math.min(...deadlines))
    const current = await this.ctx.storage.getAlarm()
    if (current === null || next < current) await this.ctx.storage.setAlarm(next)
  }
}
