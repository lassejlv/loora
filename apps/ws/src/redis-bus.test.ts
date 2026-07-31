import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  REALTIME_TICKET_TTL_MS,
  signRealtimeTicket,
  type RealtimeTicketClaims,
} from '@loora/realtime/ticket'
import { createRealtimeService, type RealtimeService } from './server'

/**
 * Everything else in this service is exercised against the in-memory bus, which
 * is one process pretending to be a room. This file is the other half: two
 * instances sharing a Redis, which is what production is the moment there is
 * more than one replica. It covers the three things that only Redis decides —
 * events crossing instances, presence being one shared room, and a ticket being
 * spent everywhere rather than once per process.
 *
 * Needs a `redis-server` binary. Without one the suite skips rather than
 * pretending to have checked.
 */

const SECRET = 's'.repeat(32)
const TOKEN = 't'.repeat(32)
const REDIS_BINARY = Bun.which('redis-server')
const PORT = 6_400 + Math.floor(Date.now() % 100)

let redis: ReturnType<typeof Bun.spawn> | null = null
let alpha: RealtimeService
let beta: RealtimeService
let ticketCounter = 0

function ticketFor(overrides: Partial<RealtimeTicketClaims> = {}) {
  const issuedAt = Date.now()
  return signRealtimeTicket(
    {
      v: 1,
      jti: `redis-ticket-${++ticketCounter}`,
      userId: 'user-1',
      sessionId: `session-${ticketCounter}`,
      ownerUserId: 'owner-1',
      designId: 'design-1',
      draftId: null,
      role: 'owner',
      name: 'Ada',
      image: null,
      color: '#6c5ce7',
      issuedAt,
      expiresAt: issuedAt + REALTIME_TICKET_TTL_MS,
      ...overrides,
    },
    SECRET,
  )
}

async function connect(service: RealtimeService, ticket: string) {
  const socket = new WebSocket(`ws://localhost:${service.server.port}/canvas`, [
    'loora.realtime.v1',
    ticket,
  ])
  const received: Record<string, unknown>[] = []
  const waiters: ((message: Record<string, unknown>) => void)[] = []
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as Record<string, unknown>
    const waiter = waiters.shift()
    if (waiter) waiter(message)
    else received.push(message)
  })
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener('error', () => reject(new Error('socket failed')), {
      once: true,
    })
  })
  return {
    socket,
    send: (message: unknown) => socket.send(JSON.stringify(message)),
    next: () =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const queued = received.shift()
        if (queued) {
          resolve(queued)
          return
        }
        const timer = setTimeout(() => reject(new Error('no message')), 4_000)
        waiters.push((message) => {
          clearTimeout(timer)
          resolve(message)
        })
      }),
    close: () =>
      new Promise<void>((resolve) => {
        socket.addEventListener('close', () => resolve(), { once: true })
        socket.close()
      }),
  }
}

function publishTo(service: RealtimeService, body: unknown) {
  return fetch(`http://localhost:${service.server.port}/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(body),
  })
}

function readStateFrom(service: RealtimeService) {
  return fetch(`http://localhost:${service.server.port}/state`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      ownerUserId: 'owner-1',
      target: { designId: 'design-1', draftId: null },
    }),
  }).then((response) => response.json() as Promise<{ peers: { userId: string }[] }>)
}

beforeAll(async () => {
  if (!REDIS_BINARY) return
  redis = Bun.spawn(
    [REDIS_BINARY, '--port', String(PORT), '--save', '', '--appendonly', 'no'],
    { stdout: 'ignore', stderr: 'ignore' },
  )
  const url = `redis://localhost:${PORT}`
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const socket = await Bun.connect({
        hostname: 'localhost',
        port: PORT,
        socket: { data() {} },
      })
      socket.end()
      break
    } catch {
      await Bun.sleep(100)
    }
  }
  const config = {
    port: 0,
    ticketSecrets: [SECRET],
    internalToken: TOKEN,
    redisUrl: url,
    allowedOrigins: null,
  }
  alpha = createRealtimeService(config)
  beta = createRealtimeService(config)
})

afterAll(async () => {
  await alpha?.stop()
  await beta?.stop()
  redis?.kill()
})

describe.skipIf(!REDIS_BINARY)('two instances on one Redis', () => {
  test('carries a published event from one instance to a socket on the other', async () => {
    const client = await connect(beta, await ticketFor())
    await client.next()

    const response = await publishTo(alpha, {
      kind: 'event',
      ownerUserId: 'owner-1',
      target: { designId: 'design-1', draftId: null },
      event: { type: 'canvas.changed', revision: 11, nodeIds: ['node-1'] },
    })

    expect(response.status).toBe(200)
    await expect(client.next()).resolves.toMatchObject({
      type: 'canvas.changed',
      revision: 11,
    })
    await client.close()
  })

  test('is one room: presence crosses, and either instance can describe it', async () => {
    const mover = await connect(alpha, await ticketFor({ sessionId: 'redis-mover' }))
    await mover.next()
    const watcher = await connect(beta, await ticketFor({ sessionId: 'redis-watcher' }))
    await watcher.next()

    mover.send({ type: 'presence', cursor: { x: 7, y: 9 }, selection: [] })

    // The other instance's socket hears about it…
    await expect(watcher.next()).resolves.toMatchObject({
      type: 'presence.peer',
      sessionId: 'redis-mover',
      peer: { cursor: { x: 7, y: 9 } },
    })
    // …and the author's own instance still does not echo it back.
    mover.send({ type: 'ping' })
    await expect(mover.next()).resolves.toMatchObject({ type: 'pong' })

    // Room state is shared, so the instance that never saw the frame can still
    // hand it to a tab that connects over the fallback.
    const fromBeta = await readStateFrom(beta)
    expect(fromBeta.peers.map((peer) => peer.userId)).toContain('user-1')
    expect(await readStateFrom(alpha)).toEqual(fromBeta)

    await Promise.all([mover.close(), watcher.close()])
  })

  test('spends a ticket across the whole deployment, not once per instance', async () => {
    const ticket = await ticketFor({ sessionId: 'redis-replay' })
    const client = await connect(alpha, ticket)
    await client.next()

    const replayOnBeta = await fetch(
      `http://localhost:${beta.server.port}/canvas?ticket=${encodeURIComponent(ticket)}`,
      { headers: { Upgrade: 'websocket' } },
    )

    expect(replayOnBeta.status).toBe(401)
    expect(await replayOnBeta.text()).toBe('Ticket already used')
    await client.close()
  })

  test('clears a peer everywhere when its socket goes', async () => {
    const leaving = await connect(alpha, await ticketFor({ sessionId: 'redis-leaver' }))
    await leaving.next()
    const watcher = await connect(beta, await ticketFor({ sessionId: 'redis-stayer' }))
    await watcher.next()
    leaving.send({ type: 'presence', cursor: null, selection: [] })
    await watcher.next()

    await leaving.close()

    await expect(watcher.next()).resolves.toMatchObject({
      type: 'presence.peer',
      sessionId: 'redis-leaver',
      peer: null,
    })
    const state = await readStateFrom(beta)
    expect(
      state.peers.some((peer) => 'sessionId' in peer && peer.sessionId === 'redis-leaver'),
    ).toBe(false)
    await watcher.close()
  })
})
