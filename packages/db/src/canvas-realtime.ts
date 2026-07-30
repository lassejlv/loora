import { RedisClient } from 'bun'

export interface CanvasRealtimeTarget {
  designId: string
  draftId?: string | null
}

export interface CanvasRealtimeActivity {
  id: string
  label: string
  nodeIds: string[]
  phase: 'working' | 'settled'
  updatedAt: number
  expiresAt: number
}

/**
 * Somebody else looking at the same document. Identity is filled in on the
 * server from the session; a client only ever supplies where its pointer is and
 * what it has selected, so a peer cannot claim to be another person.
 */
export interface CanvasPresencePeer {
  sessionId: string
  userId: string
  name: string
  image: string | null
  color: string
  role: 'owner' | 'edit' | 'view'
  /** Scene coordinates, so every viewer places it under their own camera. */
  cursor: { x: number; y: number } | null
  selection: string[]
  updatedAt: number
}

export type CanvasRealtimeEvent =
  | {
      type: 'canvas.changed'
      revision: number
      nodeIds: string[]
      sentAt: number
    }
  | {
      type: 'agent.activity'
      activity: CanvasRealtimeActivity | null
      sentAt: number
    }
  | {
      type: 'presence.peer'
      sessionId: string
      peer: CanvasPresencePeer | null
      sentAt: number
    }
  | {
      type: 'presence.state'
      peers: CanvasPresencePeer[]
      sentAt: number
    }

export type CanvasRealtimeEventInput =
  | Omit<Extract<CanvasRealtimeEvent, { type: 'canvas.changed' }>, 'sentAt'>
  | Omit<Extract<CanvasRealtimeEvent, { type: 'agent.activity' }>, 'sentAt'>
  | Omit<Extract<CanvasRealtimeEvent, { type: 'presence.peer' }>, 'sentAt'>
  | Omit<Extract<CanvasRealtimeEvent, { type: 'presence.state' }>, 'sentAt'>

export function canvasRealtimeChannel(
  userId: string,
  target: CanvasRealtimeTarget,
) {
  return [
    'loora',
    'canvas',
    encodeURIComponent(userId),
    encodeURIComponent(target.designId),
    encodeURIComponent(
      target.draftId ? `draft:${target.draftId}` : 'main',
    ),
  ].join(':')
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function nodeIds(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length <= 64 &&
    value.every(
      (id) => typeof id === 'string' && id.length > 0 && id.length <= 128,
    )
  )
}

function activity(value: unknown): value is CanvasRealtimeActivity {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.id.length <= 200 &&
    typeof value.label === 'string' &&
    value.label.length > 0 &&
    value.label.length <= 160 &&
    nodeIds(value.nodeIds) &&
    (value.phase === 'working' || value.phase === 'settled') &&
    Number.isFinite(value.updatedAt) &&
    Number.isFinite(value.expiresAt)
  )
}

export const MAX_PRESENCE_PEERS = 50
export const PRESENCE_TTL_MS = 45_000

function presencePeer(value: unknown): value is CanvasPresencePeer {
  return (
    record(value) &&
    typeof value.sessionId === 'string' &&
    value.sessionId.length > 0 &&
    value.sessionId.length <= 128 &&
    typeof value.userId === 'string' &&
    value.userId.length > 0 &&
    value.userId.length <= 128 &&
    typeof value.name === 'string' &&
    value.name.length <= 200 &&
    (value.image === null || typeof value.image === 'string') &&
    typeof value.color === 'string' &&
    /^#[0-9a-f]{6}$/i.test(value.color) &&
    (value.role === 'owner' || value.role === 'edit' || value.role === 'view') &&
    (value.cursor === null ||
      (record(value.cursor) &&
        Number.isFinite(value.cursor.x) &&
        Number.isFinite(value.cursor.y))) &&
    nodeIds(value.selection) &&
    Number.isFinite(value.updatedAt)
  )
}

export function parseCanvasRealtimeEvent(
  value: string,
): CanvasRealtimeEvent | null {
  if (value.length > 100_000) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (
    !record(parsed) ||
    !Number.isFinite(parsed.sentAt)
  ) {
    return null
  }
  if (
    parsed.type === 'canvas.changed' &&
    Number.isInteger(parsed.revision) &&
    Number(parsed.revision) >= 0 &&
    nodeIds(parsed.nodeIds)
  ) {
    return parsed as unknown as CanvasRealtimeEvent
  }
  if (
    parsed.type === 'agent.activity' &&
    (parsed.activity === null || activity(parsed.activity))
  ) {
    return parsed as unknown as CanvasRealtimeEvent
  }
  if (
    parsed.type === 'presence.peer' &&
    typeof parsed.sessionId === 'string' &&
    parsed.sessionId.length > 0 &&
    parsed.sessionId.length <= 128 &&
    (parsed.peer === null || presencePeer(parsed.peer))
  ) {
    return parsed as unknown as CanvasRealtimeEvent
  }
  if (
    parsed.type === 'presence.state' &&
    Array.isArray(parsed.peers) &&
    parsed.peers.length <= MAX_PRESENCE_PEERS &&
    parsed.peers.every(presencePeer)
  ) {
    return parsed as unknown as CanvasRealtimeEvent
  }
  return null
}

function redisUrl() {
  return process.env.REDIS_URL?.trim() || null
}

async function connect(client: RedisClient) {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    await Promise.race([
      client.connect(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Redis connection timed out')),
          3_000,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

let publisher: RedisClient | null = null
let publisherConnection: Promise<RedisClient> | null = null

async function connectedPublisher(url: string) {
  if (publisher) return publisher
  if (publisherConnection) return publisherConnection
  publisherConnection = (async () => {
    const client = new RedisClient(url)
    client.onclose = () => {
      if (publisher === client) publisher = null
    }
    try {
      await connect(client)
    } catch (error) {
      client.close()
      throw error
    }
    publisher = client
    return client
  })()
  try {
    return await publisherConnection
  } finally {
    publisherConnection = null
  }
}

export async function publishCanvasRealtimeEvent(
  userId: string,
  target: CanvasRealtimeTarget,
  event: CanvasRealtimeEventInput,
) {
  const url = redisUrl()
  if (!url) return false
  try {
    const client = await connectedPublisher(url)
    await client.publish(
      canvasRealtimeChannel(userId, target),
      JSON.stringify({ ...event, sentAt: Date.now() }),
    )
    return true
  } catch {
    publisher?.close()
    publisher = null
    console.error('[canvas-realtime] Could not publish event')
    return false
  }
}

function presenceKey(userId: string, target: CanvasRealtimeTarget) {
  return `${canvasRealtimeChannel(userId, target)}:presence`
}

function agentActivityKey(userId: string, target: CanvasRealtimeTarget) {
  return `${canvasRealtimeChannel(userId, target)}:agent`
}

/** A tool call is running. Long enough to cover a slow render. */
export const AGENT_ACTIVITY_WORKING_TTL_MS = 30_000
/** The gap between two tool calls, so the badge does not blink per call. */
export const AGENT_ACTIVITY_SETTLED_TTL_MS = 8_000

/**
 * What an external agent is doing right now. This is ephemeral state, so it
 * lives in Redis with a TTL rather than in Postgres: a tool call pays one
 * pipelined round trip instead of three statements, and an agent that died
 * mid-run stops being drawn on its own.
 */
export async function publishCanvasAgentActivity(
  userId: string,
  target: CanvasRealtimeTarget,
  current: CanvasRealtimeActivity | null,
) {
  const url = redisUrl()
  if (!url) return false
  const key = agentActivityKey(userId, target)
  try {
    const client = await connectedPublisher(url)
    const write = current
      ? client.send('SET', [
          key,
          JSON.stringify(current),
          'PX',
          String(
            Math.max(1_000, Math.round(current.expiresAt - current.updatedAt)),
          ),
        ])
      : client.send('DEL', [key])
    await Promise.all([
      write,
      client.publish(
        canvasRealtimeChannel(userId, target),
        JSON.stringify({
          type: 'agent.activity',
          activity: current,
          sentAt: Date.now(),
        }),
      ),
    ])
    return true
  } catch {
    publisher?.close()
    publisher = null
    return false
  }
}

/** For a tab that opens while an agent is already working. */
export async function readCanvasAgentActivity(
  userId: string,
  target: CanvasRealtimeTarget,
): Promise<CanvasRealtimeActivity | null> {
  const url = redisUrl()
  if (!url) return null
  let value: unknown
  try {
    const client = await connectedPublisher(url)
    value = await client.get(agentActivityKey(userId, target))
  } catch {
    publisher?.close()
    publisher = null
    return null
  }
  if (typeof value !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  return activity(parsed) && parsed.expiresAt > Date.now() ? parsed : null
}

function fresh(peer: CanvasPresencePeer, now: number) {
  return now - peer.updatedAt < PRESENCE_TTL_MS
}

/**
 * Everyone currently in the document. Held in Redis rather than in the process
 * so a second web instance sees the same room, and expired by timestamp on read
 * so a tab that vanished without a goodbye drops out on its own.
 */
export async function readCanvasPresence(
  userId: string,
  target: CanvasRealtimeTarget,
): Promise<CanvasPresencePeer[]> {
  const url = redisUrl()
  if (!url) return []
  try {
    const client = await connectedPublisher(url)
    const entries = (await client.send('HGETALL', [
      presenceKey(userId, target),
    ])) as unknown
    const values = Array.isArray(entries)
      ? entries.filter((_, index) => index % 2 === 1)
      : Object.values((entries ?? {}) as Record<string, string>)
    const now = Date.now()
    const peers: CanvasPresencePeer[] = []
    for (const value of values) {
      if (typeof value !== 'string') continue
      let parsed: unknown
      try {
        parsed = JSON.parse(value)
      } catch {
        continue
      }
      if (presencePeer(parsed) && fresh(parsed, now)) peers.push(parsed)
    }
    return peers.slice(0, MAX_PRESENCE_PEERS)
  } catch {
    publisher?.close()
    publisher = null
    return []
  }
}

/** Records where a person is and tells the room, in one round trip each. */
export async function publishCanvasPresence(
  userId: string,
  target: CanvasRealtimeTarget,
  peer: CanvasPresencePeer,
) {
  const url = redisUrl()
  if (!url) return false
  const key = presenceKey(userId, target)
  try {
    const client = await connectedPublisher(url)
    await client.send('HSET', [key, peer.sessionId, JSON.stringify(peer)])
    await client.send('PEXPIRE', [key, String(PRESENCE_TTL_MS * 4)])
    await client.publish(
      canvasRealtimeChannel(userId, target),
      JSON.stringify({
        type: 'presence.peer',
        sessionId: peer.sessionId,
        peer,
        sentAt: Date.now(),
      }),
    )
    return true
  } catch {
    publisher?.close()
    publisher = null
    return false
  }
}

export async function clearCanvasPresence(
  userId: string,
  target: CanvasRealtimeTarget,
  sessionId: string,
) {
  const url = redisUrl()
  if (!url) return false
  try {
    const client = await connectedPublisher(url)
    await client.send('HDEL', [presenceKey(userId, target), sessionId])
    await client.publish(
      canvasRealtimeChannel(userId, target),
      JSON.stringify({
        type: 'presence.peer',
        sessionId,
        peer: null,
        sentAt: Date.now(),
      }),
    )
    return true
  } catch {
    publisher?.close()
    publisher = null
    return false
  }
}

/** Stable per person, so the same collaborator keeps the same colour. */
const PRESENCE_COLORS = [
  '#6c5ce7',
  '#e056fd',
  '#00b894',
  '#0984e3',
  '#e17055',
  '#fdcb6e',
  '#e84393',
  '#00cec9',
]

export function presenceColor(userId: string) {
  let hash = 2166136261
  for (let index = 0; index < userId.length; index += 1) {
    hash ^= userId.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return PRESENCE_COLORS[(hash >>> 0) % PRESENCE_COLORS.length]!
}

export interface CanvasRealtimeSubscription {
  close: () => void
}

export async function subscribeCanvasRealtimeEvents(
  userId: string,
  target: CanvasRealtimeTarget,
  onEvent: (event: CanvasRealtimeEvent) => void,
  onClose: (error?: Error) => void,
): Promise<CanvasRealtimeSubscription | null> {
  const url = redisUrl()
  if (!url) return null
  const client = new RedisClient(url)
  let closed = false
  client.onclose = (error) => {
    if (!closed) onClose(error)
  }
  try {
    await connect(client)
  } catch (error) {
    closed = true
    client.close()
    throw error
  }
  const channel = canvasRealtimeChannel(userId, target)
  try {
    await client.subscribe(channel, (message) => {
      const event = parseCanvasRealtimeEvent(message)
      if (event) onEvent(event)
    })
  } catch (error) {
    closed = true
    client.close()
    throw error
  }
  return {
    close: () => {
      if (closed) return
      closed = true
      void client.unsubscribe(channel).catch(() => {})
      client.close()
    },
  }
}
