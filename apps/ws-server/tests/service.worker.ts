import { env, evictDurableObject, SELF } from 'cloudflare:test'
import { afterEach, describe, expect, test } from 'vitest'
import { signRealtimeTicket } from '@loora/realtime/ticket'
import { roomObjectName } from '../src/index'

const SECRET = 's'.repeat(32)
const TOKEN = 't'.repeat(32)
const sockets: WebSocket[] = []

function claims(jti: string, sessionId: string) {
  const issuedAt = Date.now()
  return {
    v: 1 as const,
    jti,
    userId: 'user-1',
    sessionId,
    ownerUserId: 'owner-1',
    designId: 'design-1',
    draftId: null,
    role: 'owner' as const,
    name: 'Ada',
    image: null,
    color: '#6c5ce7',
    issuedAt,
    expiresAt: issuedAt + 60_000,
  }
}

function nextMessage(socket: WebSocket) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WebSocket message timed out')), 2_000)
    socket.addEventListener(
      'message',
      (event) => {
        clearTimeout(timeout)
        try {
          resolve(JSON.parse(String(event.data)) as Record<string, unknown>)
        } catch (error) {
          reject(error)
        }
      },
      { once: true },
    )
  })
}

async function connect(jti: string, sessionId: string) {
  const ticket = await signRealtimeTicket(claims(jti, sessionId), SECRET)
  const response = await SELF.fetch('https://ws.loora.design/canvas', {
    headers: {
      Origin: 'https://loora.design',
      Upgrade: 'websocket',
      'Sec-WebSocket-Protocol': `loora.realtime.v1, ${ticket}`,
    },
  })
  expect(response.status).toBe(101)
  expect(response.headers.get('Sec-WebSocket-Protocol')).toBe(
    'loora.realtime.v1',
  )
  const socket = response.webSocket
  if (!socket) throw new Error('Expected WebSocket response')
  socket.accept()
  sockets.push(socket)
  const ready = await nextMessage(socket)
  expect(ready.type).toBe('ready')
  return { socket, ticket, ready }
}

afterEach(() => {
  for (const socket of sockets.splice(0)) {
    try {
      socket.close(1000, 'test complete')
    } catch {
      // The connection-cap test intentionally closes one socket early.
    }
  }
})

describe('Loora realtime Worker', () => {
  test('upgrades, pings, ingests, and survives Durable Object hibernation', async () => {
    const { socket } = await connect('ticket-main', 'session-main')

    socket.send(JSON.stringify({ type: 'ping' }))
    expect((await nextMessage(socket)).type).toBe('pong')

    const changed = nextMessage(socket)
    const response = await SELF.fetch('https://ws.loora.design/publish', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'event',
        ownerUserId: 'owner-1',
        target: { designId: 'design-1' },
        event: {
          type: 'canvas.changed',
          revision: 4,
          nodeIds: ['node-1'],
        },
      }),
    })
    expect(response.status).toBe(200)
    expect((await changed).revision).toBe(4)

    const room = env.REALTIME_ROOMS.getByName(
      await roomObjectName('owner-1', { designId: 'design-1' }),
    )
    await evictDurableObject(room)
    socket.send(JSON.stringify({ type: 'ping' }))
    expect((await nextMessage(socket)).type).toBe('pong')
  })

  test('spends tickets once', async () => {
    const { ticket } = await connect('ticket-replay', 'session-replay')
    const replay = await SELF.fetch('https://ws.loora.design/canvas', {
      headers: {
        Origin: 'https://loora.design',
        Upgrade: 'websocket',
        'Sec-WebSocket-Protocol': `loora.realtime.v1, ${ticket}`,
      },
    })
    expect(replay.status).toBe(401)
    expect(await replay.text()).toBe('Ticket already used')
  })

  test('stamps presence identity and exposes current room state', async () => {
    const mover = await connect('ticket-mover', 'mover')
    const watcher = await connect('ticket-watcher', 'watcher')
    const update = nextMessage(watcher.socket)
    mover.socket.send(
      JSON.stringify({
        type: 'presence',
        cursor: { x: 12.4, y: 8 },
        selection: ['node-1'],
        userId: 'impostor',
        name: 'Impostor',
      }),
    )
    const presence = await update
    expect(presence.type).toBe('presence.peer')
    expect(presence.sessionId).toBe('mover')
    expect(presence.peer).toMatchObject({
      userId: 'user-1',
      name: 'Ada',
      cursor: { x: 12, y: 8 },
    })

    const state = await SELF.fetch('https://ws.loora.design/state', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ownerUserId: 'owner-1',
        target: { designId: 'design-1', draftId: null },
      }),
    })
    expect(state.status).toBe(200)
    const body = await state.json<{ peers: Array<{ sessionId: string }> }>()
    expect(body.peers.map((peer) => peer.sessionId)).toContain('mover')
  })

  test('rejects a browser from an unapproved origin', async () => {
    const ticket = await signRealtimeTicket(
      claims('ticket-origin', 'session-origin'),
      SECRET,
    )
    const response = await SELF.fetch('https://ws.loora.design/canvas', {
      headers: {
        Origin: 'https://evil.example',
        Upgrade: 'websocket',
        'Sec-WebSocket-Protocol': `loora.realtime.v1, ${ticket}`,
      },
    })
    expect(response.status).toBe(403)
  })

  test('requires the internal token before parsing ingest bodies', async () => {
    const response = await SELF.fetch('https://ws.loora.design/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(response.status).toBe(401)
  })

  test('evicts the oldest socket after twenty connections for one user', async () => {
    const first = await connect('cap-0', 'cap-session-0')
    const closed = new Promise<CloseEvent>((resolve) => {
      first.socket.addEventListener('close', resolve, { once: true })
    })
    for (let index = 1; index <= 20; index += 1) {
      await connect(`cap-${index}`, `cap-session-${index}`)
    }
    const event = await closed
    expect(event.code).toBe(4002)
  })
})
