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

export type CanvasRealtimeEventInput =
  | Omit<Extract<CanvasRealtimeEvent, { type: 'canvas.changed' }>, 'sentAt'>
  | Omit<Extract<CanvasRealtimeEvent, { type: 'agent.activity' }>, 'sentAt'>

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
