import type { RateLimitBinding } from './env'

export type Decision = {
  ok: boolean
  limit: number
  remaining: number
  retryAfter: number
}

export type RateLimitRule = {
  limit: number
  windowMs: number
}

/** Same buckets the Rust transport counted, documented on `@loora/rpc/rate-limit`. */
export const mcpRateLimits = {
  mcp: { limit: 240, windowMs: 60_000 },
  'mcp-address': { limit: 600, windowMs: 60_000 },
  'mcp-anonymous': { limit: 60, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>

const COUNT_SCRIPT = `local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return hits`

const CONNECT_TIMEOUT_MS = 1_500
const COMMAND_TIMEOUT_MS = 1_000
const UNAVAILABLE_COOLDOWN_MS = 10_000
const MEMORY_TRACKED_KEYS = 50_000

type BunRedisClient = {
  connect(): Promise<unknown>
  close(): void
  send(command: string, args: string[]): Promise<unknown>
  onclose: ((error: Error) => void) | null
}

declare const Bun:
  | { RedisClient?: new (url: string) => BunRedisClient }
  | undefined

type MemoryEntry = { hits: number; expiresAt: number }

export type RateLimiterOptions = {
  redisUrl?: string | null
  bindings?: {
    mcp?: RateLimitBinding
    'mcp-address'?: RateLimitBinding
    'mcp-anonymous'?: RateLimitBinding
  }
  now?: () => number
}

export class RateLimiter {
  private readonly redisUrl: string | null
  private readonly bindings: RateLimiterOptions['bindings']
  private readonly now: () => number
  private readonly memory = new Map<string, MemoryEntry>()
  private client: BunRedisClient | null = null
  private connecting: Promise<BunRedisClient> | null = null
  private unavailableUntil = 0

  constructor(options: RateLimiterOptions = {}) {
    this.redisUrl = options.redisUrl ?? null
    this.bindings = options.bindings
    this.now = options.now ?? Date.now
  }

  async check(bucket: keyof typeof mcpRateLimits, identity: string) {
    const rule = mcpRateLimits[bucket]
    const binding = this.bindings?.[bucket]
    if (binding) {
      const { success } = await binding.limit({ key: identity })
      return {
        ok: success,
        limit: rule.limit,
        remaining: success ? rule.limit : 0,
        retryAfter: Math.max(1, Math.ceil(rule.windowMs / 1_000)),
      } satisfies Decision
    }
    const hits = await this.count(`ratelimit:${bucket}:${identity}`, rule.windowMs)
    return {
      ok: hits <= rule.limit,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - hits),
      retryAfter: Math.max(1, Math.ceil(rule.windowMs / 1_000)),
    } satisfies Decision
  }

  private async count(key: string, windowMs: number) {
    const redisHits = await this.countRedis(key, windowMs)
    if (redisHits !== null) return redisHits
    return this.countMemory(key, windowMs)
  }

  private async countRedis(key: string, windowMs: number) {
    const url = this.redisUrl
    if (!url || this.now() < this.unavailableUntil) return null
    if (typeof Bun === 'undefined' || !Bun?.RedisClient) return null
    try {
      const redis = await this.connected(url)
      const hits = await withTimeout(
        redis.send('EVAL', [COUNT_SCRIPT, '1', key, String(windowMs)]),
        COMMAND_TIMEOUT_MS,
      )
      return Number(hits)
    } catch {
      this.unavailableUntil = this.now() + UNAVAILABLE_COOLDOWN_MS
      this.client?.close()
      this.client = null
      return null
    }
  }

  private async connected(url: string) {
    if (this.client) return this.client
    if (this.connecting) return this.connecting
    const RedisClient = Bun?.RedisClient
    if (!RedisClient) throw new Error('Bun.RedisClient is unavailable')
    this.connecting = (async () => {
      const next = new RedisClient(url)
      next.onclose = () => {
        if (this.client === next) this.client = null
      }
      try {
        await withTimeout(next.connect(), CONNECT_TIMEOUT_MS)
      } catch (error) {
        next.close()
        throw error
      }
      this.client = next
      return next
    })()
    try {
      return await this.connecting
    } finally {
      this.connecting = null
    }
  }

  private countMemory(key: string, windowMs: number) {
    const now = this.now()
    const seen = this.memory.get(key)
    if (!seen || seen.expiresAt <= now) {
      if (this.memory.size >= MEMORY_TRACKED_KEYS) {
        for (const [id, entry] of this.memory) {
          if (entry.expiresAt <= now) this.memory.delete(id)
        }
        if (this.memory.size >= MEMORY_TRACKED_KEYS) {
          const oldest = this.memory.keys().next()
          if (!oldest.done) this.memory.delete(oldest.value)
        }
      }
      this.memory.set(key, { hits: 1, expiresAt: now + windowMs })
      return 1
    }
    seen.hits += 1
    return seen.hits
  }
}

function withTimeout<T>(work: Promise<T>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Redis timed out')), ms)
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

export function callerIdentity(headers: Headers) {
  const connecting = headers.get('cf-connecting-ip')?.trim()
  if (connecting) return `ip:${connecting}`
  const forwarded = headers.get('x-forwarded-for')?.trim()
  if (forwarded && !forwarded.includes(',')) return `ip:${forwarded}`
  return 'ip:unknown'
}
