import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  REALTIME_TICKET_TTL_MS,
  signRealtimeTicket,
  type RealtimeTicketClaims,
} from '@loora/realtime/ticket'
import {
  CLOSE_TOO_MANY,
  createRealtimeService,
  MAX_SOCKETS_PER_USER,
  type RealtimeService,
} from './server'

const SECRET = 's'.repeat(32)
const TOKEN = 't'.repeat(32)

let service: RealtimeService
let origin: string
// Tickets are single use, so every connection in this file needs its own id.
let ticketCounter = 0

function ticketFor(overrides: Partial<RealtimeTicketClaims> = {}) {
  const issuedAt = Date.now()
  return signRealtimeTicket(
    {
      v: 1,
      jti: `ticket-${++ticketCounter}`,
      userId: 'user-1',
      sessionId: 'session-1',
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

/**
 * Opens a socket and hands back the messages it receives, in order. The ticket
 * travels as a subprotocol, which is how the browser client sends it; the query
 * form has its own test.
 */
async function connect(ticket: string) {
  const socket = new WebSocket(`${origin.replace('http', 'ws')}/canvas`, [
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
        const timer = setTimeout(() => reject(new Error('no message')), 2_000)
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

function publish(body: unknown, token = TOKEN) {
  return fetch(`${origin}/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
}

beforeAll(() => {
  service = createRealtimeService({
    port: 0,
    ticketSecrets: [SECRET],
    internalToken: TOKEN,
    redisUrl: null,
    allowedOrigins: null,
  })
  origin = `http://localhost:${service.server.port}`
})

afterAll(async () => {
  await service.stop()
})

describe('realtime service', () => {
  test('reports health without a ticket', async () => {
    const response = await fetch(`${origin}/health`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ name: 'loora-ws', bus: 'memory' })
  })

  test('reports readiness from the bus, not from being alive', async () => {
    const response = await fetch(`${origin}/ready`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ready: true, bus: 'memory' })

    // A bus that cannot be reached has to fail the check: the process is still
    // up, but its rooms have stopped being shared.
    const ping = service.bus.ping
    service.bus.ping = async () => false
    const unreachable = await fetch(`${origin}/ready`)
    service.bus.ping = ping

    expect(unreachable.status).toBe(503)
    expect(await unreachable.json()).toMatchObject({ ready: false })
  })

  test('refuses a socket without a valid ticket', async () => {
    const response = await fetch(`${origin}/canvas?ticket=nonsense`, {
      headers: { Upgrade: 'websocket' },
    })

    expect(response.status).toBe(401)
  })

  test('sends the room state on connect', async () => {
    const client = await connect(await ticketFor())

    await expect(client.next()).resolves.toMatchObject({
      type: 'ready',
      sessionId: 'session-1',
      role: 'owner',
      peers: [],
      activity: null,
    })
    await client.close()
  })

  test('fans a published canvas change out to the room', async () => {
    const client = await connect(await ticketFor())
    await client.next()

    const response = await publish({
      kind: 'event',
      ownerUserId: 'owner-1',
      target: { designId: 'design-1', draftId: null },
      event: { type: 'canvas.changed', revision: 4, nodeIds: ['node-1'] },
    })

    expect(response.status).toBe(200)
    await expect(client.next()).resolves.toMatchObject({
      type: 'canvas.changed',
      revision: 4,
      nodeIds: ['node-1'],
    })
    await client.close()
  })

  test('carries agent activity from an MCP tool call', async () => {
    const client = await connect(await ticketFor())
    await client.next()
    const now = Date.now()

    await publish({
      kind: 'activity',
      ownerUserId: 'owner-1',
      target: { designId: 'design-1', draftId: null },
      activity: {
        id: 'agent_1',
        label: 'Adding elements',
        nodeIds: ['node-1'],
        phase: 'working',
        updatedAt: now,
        expiresAt: now + 30_000,
      },
    })

    await expect(client.next()).resolves.toMatchObject({
      type: 'agent.activity',
      activity: { id: 'agent_1', label: 'Adding elements' },
    })
    // A tab that opens mid-run sees the same thing without waiting for the next
    // tool call.
    const late = await connect(await ticketFor({ sessionId: 'session-2' }))
    await expect(late.next()).resolves.toMatchObject({
      type: 'ready',
      activity: { id: 'agent_1' },
    })
    await Promise.all([client.close(), late.close()])
  })

  test('stamps presence from the ticket, not from the client', async () => {
    const client = await connect(await ticketFor())
    await client.next()
    const other = await connect(await ticketFor({ sessionId: 'session-2' }))
    await other.next()

    client.send({
      type: 'presence',
      cursor: { x: 12.4, y: 8 },
      selection: ['node-1'],
      // Ignored: the room does not take identity from a socket.
      userId: 'someone-else',
      role: 'owner',
      name: 'Impostor',
    })

    const event = await other.next()
    expect(event).toMatchObject({ type: 'presence.peer', sessionId: 'session-1' })
    expect(event.peer).toMatchObject({
      userId: 'user-1',
      name: 'Ada',
      role: 'owner',
      cursor: { x: 12, y: 8 },
      selection: ['node-1'],
    })

    await client.close()
    // Leaving clears the peer for everyone still in the room.
    await expect(other.next()).resolves.toMatchObject({
      type: 'presence.peer',
      sessionId: 'session-1',
      peer: null,
    })
    await other.close()
  })

  test('does not echo a peer its own presence', async () => {
    const client = await connect(await ticketFor({ sessionId: 'echo-author' }))
    await client.next()
    const other = await connect(await ticketFor({ sessionId: 'echo-watcher' }))
    await other.next()

    client.send({ type: 'presence', cursor: { x: 1, y: 2 }, selection: [] })
    // Wait until the room has actually been told, so an echo — if there were
    // one — would already be sitting in the author's queue ahead of this ping.
    await expect(other.next()).resolves.toMatchObject({
      type: 'presence.peer',
      sessionId: 'echo-author',
    })
    client.send({ type: 'ping' })

    await expect(client.next()).resolves.toMatchObject({ type: 'pong' })
    await Promise.all([client.close(), other.close()])
  })

  test('answers a heartbeat', async () => {
    const client = await connect(await ticketFor())
    await client.next()

    client.send({ type: 'ping' })

    await expect(client.next()).resolves.toMatchObject({ type: 'pong' })
    await client.close()
  })

  test('keeps rooms apart', async () => {
    const client = await connect(await ticketFor())
    await client.next()

    await publish({
      kind: 'event',
      ownerUserId: 'owner-1',
      target: { designId: 'another-design', draftId: null },
      event: { type: 'canvas.changed', revision: 9, nodeIds: [] },
    })
    client.send({ type: 'ping' })

    // The pong arrives first only because the other room's event never does.
    await expect(client.next()).resolves.toMatchObject({ type: 'pong' })
    await client.close()
  })

  test('still accepts a ticket in the query string', async () => {
    const ticket = await ticketFor({ sessionId: 'session-query' })
    const socket = new WebSocket(
      `${origin.replace('http', 'ws')}/canvas?ticket=${encodeURIComponent(ticket)}`,
    )
    const opened = new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true })
      socket.addEventListener('error', () => reject(new Error('socket failed')), {
        once: true,
      })
    })

    await expect(opened).resolves.toBeUndefined()
    socket.close()
  })

  test('spends a ticket once: a replay is refused', async () => {
    const ticket = await ticketFor({ sessionId: 'session-replay' })
    const client = await connect(ticket)
    await client.next()

    const replay = await fetch(
      `${origin}/canvas?ticket=${encodeURIComponent(ticket)}`,
      { headers: { Upgrade: 'websocket' } },
    )

    expect(replay.status).toBe(401)
    expect(await replay.text()).toBe('Ticket already used')
    await client.close()
  })

  test('caps how many sockets one account can hold open', async () => {
    const clients = []
    for (let index = 0; index <= MAX_SOCKETS_PER_USER; index += 1) {
      const client = await connect(await ticketFor({ sessionId: `cap-${index}` }))
      await client.next()
      clients.push(client)
    }

    // The oldest gives way; the tab that just connected keeps working.
    const [oldest] = clients
    const closed = await new Promise<number>((resolve) => {
      if (oldest!.socket.readyState === WebSocket.CLOSED) {
        resolve(CLOSE_TOO_MANY)
        return
      }
      oldest!.socket.addEventListener(
        'close',
        (event) => resolve((event as CloseEvent).code),
        { once: true },
      )
    })
    expect(closed).toBe(CLOSE_TOO_MANY)

    // The room also announces the closed peer, so read past whatever else
    // arrived and look for the answer to this ping.
    const newest = clients.at(-1)!
    newest.send({ type: 'ping' })
    let answered = false
    for (let attempt = 0; attempt < 5 && !answered; attempt += 1) {
      answered = (await newest.next()).type === 'pong'
    }
    expect(answered).toBe(true)
    await Promise.all(clients.slice(1).map((client) => client.close()))
  })

  test('counts what it turned away', async () => {
    const before = service.counters.snapshot()

    await fetch(`${origin}/canvas?ticket=nonsense`, {
      headers: { Upgrade: 'websocket' },
    })
    await publish({ kind: 'event' }, 'wrong-token')
    await publish({ kind: 'nonsense' })

    const after = (await (await fetch(`${origin}/health`)).json()) as {
      rejections: Record<string, number>
    }
    expect(after.rejections.ticketInvalid).toBe(before.ticketInvalid + 1)
    expect(after.rejections.ingestUnauthorized).toBe(
      before.ingestUnauthorized + 1,
    )
    expect(after.rejections.ingestInvalid).toBe(before.ingestInvalid + 1)
  })

  test('refuses an ingest body far larger than any event', async () => {
    const response = await fetch(`${origin}/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ kind: 'event', padding: 'x'.repeat(70_000) }),
    })

    expect(response.status).toBe(413)
  })

  test('refuses ingest without the internal token', async () => {
    const body = {
      kind: 'event',
      ownerUserId: 'owner-1',
      target: { designId: 'design-1', draftId: null },
      event: { type: 'canvas.changed', revision: 1, nodeIds: [] },
    }

    expect((await publish(body, 'wrong-token')).status).toBe(401)
    expect((await publish({ kind: 'nope' })).status).toBe(400)
  })

  test('serves room state to another service', async () => {
    const client = await connect(await ticketFor())
    await client.next()
    client.send({ type: 'presence', cursor: null, selection: [] })

    // Nothing comes back to the author of a presence frame, so poll the room
    // rather than waiting for an echo that no longer exists.
    const readState = () =>
      fetch(`${origin}/state`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TOKEN}`,
        },
        body: JSON.stringify({
          ownerUserId: 'owner-1',
          target: { designId: 'design-1', draftId: null },
        }),
      })
    let response = await readState()
    let state = (await response.json()) as { peers: { userId: string }[] }
    for (let attempt = 0; attempt < 20 && state.peers.length === 0; attempt += 1) {
      await Bun.sleep(25)
      response = await readState()
      state = (await response.json()) as { peers: { userId: string }[] }
    }

    expect(response.status).toBe(200)
    expect(state.peers).toHaveLength(1)
    expect(state.peers[0]).toMatchObject({ userId: 'user-1' })
    await client.close()
  })
})
