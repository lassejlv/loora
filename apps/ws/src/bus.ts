import { RedisClient } from 'bun'
import {
  isCanvasPresencePeer,
  isCanvasRealtimeActivity,
  isPresenceFresh,
  MAX_PRESENCE_PEERS,
  PRESENCE_TTL_MS,
  type CanvasPresencePeer,
  type CanvasRealtimeActivity,
} from '@loora/realtime/events'

/**
 * Where a room lives between service instances.
 *
 * One process can hold a whole room in memory, and in development it does. In
 * production two instances must see the same room, so the same interface is
 * implemented over Redis: pub/sub carries the events, a hash holds presence,
 * and a key with a TTL holds whatever an agent is doing.
 */
export interface RealtimeBus {
  readonly kind: 'memory' | 'redis'
  subscribe(channel: string, onMessage: (message: string) => void): Promise<void>
  unsubscribe(channel: string): Promise<void>
  publish(channel: string, message: string): Promise<boolean>
  writePresence(channel: string, peer: CanvasPresencePeer): Promise<void>
  clearPresence(channel: string, sessionId: string): Promise<void>
  readPresence(channel: string): Promise<CanvasPresencePeer[]>
  writeActivity(
    channel: string,
    activity: CanvasRealtimeActivity | null,
  ): Promise<void>
  readActivity(channel: string): Promise<CanvasRealtimeActivity | null>
  /**
   * Records a ticket id as spent. `false` means it was already used, which is
   * a replay — the guarantee has to hold across instances, so it lives on the
   * bus rather than in one process's memory.
   */
  claimTicket(ticketId: string, ttlMs: number): Promise<boolean>
  close(): void
}

/** Long enough that a live room never expires between presence heartbeats. */
const PRESENCE_KEY_TTL_MS = PRESENCE_TTL_MS * 4

function presenceKey(channel: string) {
  return `${channel}:presence`
}

function activityKey(channel: string) {
  return `${channel}:agent`
}

function ticketKey(ticketId: string) {
  return `loora:realtime:ticket:${ticketId}`
}

function livePresence(values: unknown[], now: number) {
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
}

function liveActivity(value: unknown, now: number) {
  if (typeof value !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  return isCanvasRealtimeActivity(parsed) && parsed.expiresAt > now
    ? parsed
    : null
}

/**
 * Single-process rooms. Publishing echoes straight back to the local
 * subscriber, so the service behaves the same with and without Redis — the
 * difference is only how far an event travels.
 */
export class MemoryBus implements RealtimeBus {
  readonly kind = 'memory' as const
  #handlers = new Map<string, (message: string) => void>()
  #presence = new Map<string, Map<string, CanvasPresencePeer>>()
  #activity = new Map<string, CanvasRealtimeActivity>()
  #tickets = new Map<string, number>()

  async subscribe(channel: string, onMessage: (message: string) => void) {
    this.#handlers.set(channel, onMessage)
  }

  async unsubscribe(channel: string) {
    this.#handlers.delete(channel)
  }

  async publish(channel: string, message: string) {
    this.#handlers.get(channel)?.(message)
    return true
  }

  async writePresence(channel: string, peer: CanvasPresencePeer) {
    const room = this.#presence.get(channel) ?? new Map()
    room.set(peer.sessionId, peer)
    this.#presence.set(channel, room)
  }

  async clearPresence(channel: string, sessionId: string) {
    const room = this.#presence.get(channel)
    if (!room) return
    room.delete(sessionId)
    if (room.size === 0) this.#presence.delete(channel)
  }

  async readPresence(channel: string) {
    const room = this.#presence.get(channel)
    if (!room) return []
    const now = Date.now()
    for (const [sessionId, peer] of room) {
      if (!isPresenceFresh(peer, now)) room.delete(sessionId)
    }
    return [...room.values()].slice(0, MAX_PRESENCE_PEERS)
  }

  async writeActivity(
    channel: string,
    activity: CanvasRealtimeActivity | null,
  ) {
    if (activity) this.#activity.set(channel, activity)
    else this.#activity.delete(channel)
  }

  async readActivity(channel: string) {
    const activity = this.#activity.get(channel)
    if (!activity) return null
    if (activity.expiresAt <= Date.now()) {
      this.#activity.delete(channel)
      return null
    }
    return activity
  }

  async claimTicket(ticketId: string, ttlMs: number) {
    const now = Date.now()
    for (const [id, expiresAt] of this.#tickets) {
      if (expiresAt <= now) this.#tickets.delete(id)
    }
    if (this.#tickets.has(ticketId)) return false
    this.#tickets.set(ticketId, now + ttlMs)
    return true
  }

  close() {
    this.#handlers.clear()
    this.#presence.clear()
    this.#activity.clear()
    this.#tickets.clear()
  }
}

const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 15_000

/**
 * Rooms shared across instances. Redis forbids ordinary commands on a
 * subscribed connection, so the subscriber and the command client are separate
 * — and the subscriber re-subscribes every live channel when it comes back,
 * because a dropped subscription is otherwise a room that silently stops
 * updating.
 */
export class RedisBus implements RealtimeBus {
  readonly kind = 'redis' as const
  #url: string
  #handlers = new Map<string, (message: string) => void>()
  #subscriber: RedisClient | null = null
  #subscriberConnection: Promise<RedisClient> | null = null
  #commander: RedisClient | null = null
  #commanderConnection: Promise<RedisClient> | null = null
  #reconnectDelay = RECONNECT_BASE_MS
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null
  #closed = false

  constructor(url: string) {
    this.#url = url
  }

  async #connect(client: RedisClient) {
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

  async #getSubscriber(): Promise<RedisClient> {
    if (this.#subscriber) return this.#subscriber
    if (this.#subscriberConnection) return this.#subscriberConnection
    this.#subscriberConnection = (async () => {
      const client = new RedisClient(this.#url)
      client.onclose = () => {
        if (this.#subscriber !== client) return
        this.#subscriber = null
        this.#scheduleResubscribe()
      }
      try {
        await this.#connect(client)
      } catch (error) {
        client.close()
        throw error
      }
      this.#subscriber = client
      return client
    })()
    try {
      return await this.#subscriberConnection
    } finally {
      this.#subscriberConnection = null
    }
  }

  #scheduleResubscribe() {
    if (this.#closed || this.#reconnectTimer || this.#handlers.size === 0) return
    const delay = this.#reconnectDelay
    this.#reconnectDelay = Math.min(RECONNECT_MAX_MS, delay * 2)
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null
      void this.#resubscribeAll()
    }, delay)
  }

  async #resubscribeAll() {
    if (this.#closed || this.#handlers.size === 0) return
    try {
      const client = await this.#getSubscriber()
      for (const [channel, handler] of this.#handlers) {
        await client.subscribe(channel, handler)
      }
      this.#reconnectDelay = RECONNECT_BASE_MS
      console.info(`[loora-ws] resubscribed ${this.#handlers.size} channel(s)`)
    } catch {
      this.#scheduleResubscribe()
    }
  }

  async #getCommander(): Promise<RedisClient> {
    if (this.#commander) return this.#commander
    if (this.#commanderConnection) return this.#commanderConnection
    this.#commanderConnection = (async () => {
      const client = new RedisClient(this.#url)
      client.onclose = () => {
        if (this.#commander === client) this.#commander = null
      }
      try {
        await this.#connect(client)
      } catch (error) {
        client.close()
        throw error
      }
      this.#commander = client
      return client
    })()
    try {
      return await this.#commanderConnection
    } finally {
      this.#commanderConnection = null
    }
  }

  async #command<T>(run: (client: RedisClient) => Promise<T>): Promise<T> {
    const client = await this.#getCommander()
    try {
      return await run(client)
    } catch (error) {
      // A broken command connection should not poison the next call.
      this.#commander?.close()
      this.#commander = null
      throw error
    }
  }

  async subscribe(channel: string, onMessage: (message: string) => void) {
    this.#handlers.set(channel, onMessage)
    const client = await this.#getSubscriber()
    await client.subscribe(channel, onMessage)
  }

  async unsubscribe(channel: string) {
    this.#handlers.delete(channel)
    const client = this.#subscriber
    if (!client) return
    await client.unsubscribe(channel).catch(() => undefined)
  }

  async publish(channel: string, message: string) {
    await this.#command((client) => client.publish(channel, message))
    return true
  }

  async writePresence(channel: string, peer: CanvasPresencePeer) {
    const key = presenceKey(channel)
    await this.#command(async (client) => {
      await client.send('HSET', [key, peer.sessionId, JSON.stringify(peer)])
      await client.send('PEXPIRE', [key, String(PRESENCE_KEY_TTL_MS)])
    })
  }

  async clearPresence(channel: string, sessionId: string) {
    await this.#command((client) =>
      client.send('HDEL', [presenceKey(channel), sessionId]),
    )
  }

  async readPresence(channel: string) {
    const entries = await this.#command((client) =>
      client.send('HGETALL', [presenceKey(channel)]),
    )
    const values = Array.isArray(entries)
      ? entries.filter((_, index) => index % 2 === 1)
      : Object.values((entries ?? {}) as Record<string, string>)
    return livePresence(values, Date.now())
  }

  async writeActivity(
    channel: string,
    activity: CanvasRealtimeActivity | null,
  ) {
    const key = activityKey(channel)
    await this.#command((client) =>
      activity
        ? client.send('SET', [
            key,
            JSON.stringify(activity),
            'PX',
            String(
              Math.max(
                1_000,
                Math.round(activity.expiresAt - activity.updatedAt),
              ),
            ),
          ])
        : client.send('DEL', [key]),
    )
  }

  async readActivity(channel: string) {
    const value = await this.#command((client) => client.get(activityKey(channel)))
    return liveActivity(value, Date.now())
  }

  async claimTicket(ticketId: string, ttlMs: number) {
    // SET NX is the whole guarantee: the first connection wins the key, every
    // later one finds it taken. A Redis that is unreachable fails the claim
    // rather than waving the connection through.
    const claimed = await this.#command((client) =>
      client.send('SET', [
        ticketKey(ticketId),
        '1',
        'NX',
        'PX',
        String(Math.max(1_000, Math.round(ttlMs))),
      ]),
    )
    return claimed === 'OK' || claimed === true
  }

  close() {
    this.#closed = true
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer)
    this.#reconnectTimer = null
    this.#handlers.clear()
    this.#subscriber?.close()
    this.#commander?.close()
    this.#subscriber = null
    this.#commander = null
  }
}

export function createBus(redisUrl: string | null): RealtimeBus {
  return redisUrl ? new RedisBus(redisUrl) : new MemoryBus()
}
