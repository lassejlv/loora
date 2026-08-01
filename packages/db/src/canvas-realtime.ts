import { RedisClient } from 'bun'
import {
  canvasRealtimeChannel,
  isCanvasPresencePeer,
  isCanvasRealtimeActivity,
  isPresenceFresh,
  MAX_PRESENCE_PEERS,
  parseCanvasRealtimeEvent,
  PRESENCE_TTL_MS,
  type CanvasPresencePeer,
  type CanvasRealtimeActivity,
  type CanvasRealtimeEvent,
  type CanvasRealtimeEventInput,
  type CanvasRealtimeTarget,
} from '@loora/realtime/events'
import {
  readRealtimeRoomState,
  realtimeIngestConfig,
  sendRealtimeIngest,
} from '@loora/realtime/ingest'

/**
 * Server-side realtime plumbing.
 *
 * The wire protocol itself lives in `@loora/realtime`; this module is the part
 * that talks to infrastructure. Publishes prefer the WebSocket service's ingest
 * endpoint when one is configured — that service owns the room state and the
 * Redis bus — and fall back to publishing on Redis directly so a deployment
 * without the socket service keeps working.
 */

export {
  AGENT_ACTIVITY_SETTLED_TTL_MS,
  AGENT_ACTIVITY_WORKING_TTL_MS,
  canvasRealtimeChannel,
  MAX_PRESENCE_PEERS,
  parseCanvasRealtimeEvent,
  presenceColor,
  PRESENCE_TTL_MS,
  type CanvasPresencePeer,
  type CanvasRealtimeActivity,
  type CanvasRealtimeEvent,
  type CanvasRealtimeEventInput,
  type CanvasRealtimeTarget,
} from '@loora/realtime/events'

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

function dropPublisher() {
  publisher?.close()
  publisher = null
}

export async function publishCanvasRealtimeEvent(
  userId: string,
  target: CanvasRealtimeTarget,
  event: CanvasRealtimeEventInput,
) {
  if (
    await sendRealtimeIngest({ kind: 'event', ownerUserId: userId, target, event })
  ) {
    return true
  }
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
    dropPublisher()
    console.error('[canvas-realtime] Could not publish event')
    return false
  }
}

/**
 * Notifies every viewer of a design — on Main and on the branch itself — that
 * a branch's lifecycle changed (created, proposed, reopened, closed, applied).
 *
 * Goes to the Main channel so the branch list refreshes for anybody editing
 * Main, and to the draft's own channel so the person on that branch sees it
 * too. Viewers on a different branch pick it up on their next refresh.
 */
export async function publishBranchChanged(
  userId: string,
  designId: string,
  draftId: string | null,
  status: string | null,
) {
  const event: CanvasRealtimeEventInput = {
    type: 'branch.changed',
    draftId,
    status,
  }
  await Promise.all([
    publishCanvasRealtimeEvent(userId, { designId }, event),
    draftId
      ? publishCanvasRealtimeEvent(userId, { designId, draftId }, event)
      : null,
  ])
}

function presenceKey(userId: string, target: CanvasRealtimeTarget) {
  return `${canvasRealtimeChannel(userId, target)}:presence`
}

function agentActivityKey(userId: string, target: CanvasRealtimeTarget) {
  return `${canvasRealtimeChannel(userId, target)}:agent`
}

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
  if (
    await sendRealtimeIngest({
      kind: 'activity',
      ownerUserId: userId,
      target,
      activity: current,
    })
  ) {
    return true
  }
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
    dropPublisher()
    return false
  }
}

/** For a tab that opens while an agent is already working. */
export async function readCanvasAgentActivity(
  userId: string,
  target: CanvasRealtimeTarget,
): Promise<CanvasRealtimeActivity | null> {
  if (realtimeIngestConfig()) {
    const state = await readRealtimeRoomState(userId, target)
    if (state) {
      return state.activity && isCanvasRealtimeActivity(state.activity)
        ? state.activity
        : null
    }
  }
  const url = redisUrl()
  if (!url) return null
  let value: unknown
  try {
    const client = await connectedPublisher(url)
    value = await client.get(agentActivityKey(userId, target))
  } catch {
    dropPublisher()
    return null
  }
  if (typeof value !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  return isCanvasRealtimeActivity(parsed) && parsed.expiresAt > Date.now()
    ? parsed
    : null
}

/**
 * Everyone currently in the document. Held outside the process so a second web
 * instance sees the same room, and expired by timestamp on read so a tab that
 * vanished without a goodbye drops out on its own.
 */
export async function readCanvasPresence(
  userId: string,
  target: CanvasRealtimeTarget,
): Promise<CanvasPresencePeer[]> {
  if (realtimeIngestConfig()) {
    const state = await readRealtimeRoomState(userId, target)
    if (state) return state.peers.slice(0, MAX_PRESENCE_PEERS)
  }
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
      if (isCanvasPresencePeer(parsed) && isPresenceFresh(parsed, now)) {
        peers.push(parsed)
      }
    }
    return peers.slice(0, MAX_PRESENCE_PEERS)
  } catch {
    dropPublisher()
    return []
  }
}

/** Long enough that a live room never expires between heartbeats. */
const PRESENCE_KEY_TTL_MS = PRESENCE_TTL_MS * 4

/** Records where a person is and tells the room, in one round trip each. */
export async function publishCanvasPresence(
  userId: string,
  target: CanvasRealtimeTarget,
  peer: CanvasPresencePeer,
) {
  if (
    await sendRealtimeIngest({
      kind: 'presence',
      ownerUserId: userId,
      target,
      peer,
    })
  ) {
    return true
  }
  const url = redisUrl()
  if (!url) return false
  const key = presenceKey(userId, target)
  try {
    const client = await connectedPublisher(url)
    await client.send('HSET', [key, peer.sessionId, JSON.stringify(peer)])
    await client.send('PEXPIRE', [key, String(PRESENCE_KEY_TTL_MS)])
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
    dropPublisher()
    return false
  }
}

export async function clearCanvasPresence(
  userId: string,
  target: CanvasRealtimeTarget,
  sessionId: string,
) {
  if (
    await sendRealtimeIngest({
      kind: 'presence.clear',
      ownerUserId: userId,
      target,
      sessionId,
    })
  ) {
    return true
  }
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
    dropPublisher()
    return false
  }
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
