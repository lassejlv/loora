/**
 * Request rate limiting, shared by the web API routes and the MCP server.
 *
 * Counting lives in its own Redis (`REDIS_RATELIMIT_URL`) rather than the
 * realtime one, so a burst of counter writes cannot slow the room bus down and
 * losing one does not take the other with it. Every instance counts against the
 * same keys, which is what makes a limit mean anything once more than one web
 * container is running.
 *
 * Without that URL — local development, or a Redis that has gone away — the
 * count falls back to this process's memory. That is weaker (an attacker spread
 * across instances gets a multiple of the limit) but it is never wrong in the
 * direction that matters: a caller in a loop still gets stopped, and a Redis
 * outage never takes the API down with it.
 */

/**
 * Bun's Redis client is reached through the global rather than imported from
 * `'bun'`. This module is pulled into the web app's Vite build, which cannot
 * resolve that specifier — the same reason `storage.ts` reaches for
 * `Bun.S3Client` this way. Without a Bun runtime there is no client, and the
 * counting below falls back to memory.
 */
interface BunRedisClient {
  connect(): Promise<unknown>
  close(): void
  send(command: string, args: string[]): Promise<unknown>
  onclose: ((error: Error) => void) | null
}

declare const Bun:
  | { RedisClient?: new (url: string) => BunRedisClient }
  | undefined

export interface RateLimitRule {
  /** How many requests one identity may make inside the window. */
  limit: number
  windowMs: number
}

export interface RateLimitDecision {
  ok: boolean
  limit: number
  /** How many requests are left in the window; never negative. */
  remaining: number
  /** What to put in `Retry-After`. At least 1, so a client never busy-loops. */
  retryAfterSeconds: number
}

/**
 * One round trip per check: the TTL is set only on the request that opened the
 * window, and every later request in that window just increments. A fixed
 * window lets a caller spend two windows' worth of requests across a window
 * boundary — for turning away loops and brute force, that is close enough, and
 * it costs one command instead of a sorted set per identity.
 */
const COUNT_SCRIPT = `local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return hits`

const CONNECT_TIMEOUT_MS = 1_500
const COMMAND_TIMEOUT_MS = 1_000
/**
 * How long to stop reaching for a Redis that just failed. Without this, every
 * request during an outage would wait out the connect timeout before falling
 * back — the limiter would become the outage.
 */
const UNAVAILABLE_COOLDOWN_MS = 10_000
const MEMORY_TRACKED_KEYS = 50_000

function redisUrl() {
  return process.env.REDIS_RATELIMIT_URL?.trim() || null
}

let client: BunRedisClient | null = null
let connection: Promise<BunRedisClient> | null = null
let unavailableUntil = 0
let warnedUnavailable = false

/**
 * Neither `connect()` nor a command carries its own deadline, and a socket to
 * a host that has gone away can hang indefinitely. Nothing in front of a
 * request is allowed to do that.
 */
function withTimeout<T>(work: Promise<T>, ms: number, label: string) {
  let timer: ReturnType<typeof setTimeout> | null = null
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Redis ${label} timed out`)), ms)
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

async function connected(url: string) {
  if (client) return client
  if (connection) return connection
  if (typeof Bun === 'undefined' || !Bun?.RedisClient) {
    throw new Error('Bun.RedisClient is unavailable in this runtime')
  }
  const RedisClient = Bun.RedisClient
  connection = (async () => {
    const next = new RedisClient(url)
    next.onclose = () => {
      if (client === next) client = null
    }
    try {
      await withTimeout(next.connect(), CONNECT_TIMEOUT_MS, 'connection')
    } catch (error) {
      next.close()
      throw error
    }
    client = next
    return next
  })()
  try {
    return await connection
  } finally {
    connection = null
  }
}

/** Test seam: drops the cached connection so a suite can start clean. */
export function resetRateLimitClient() {
  client?.close()
  client = null
  connection = null
  unavailableUntil = 0
  warnedUnavailable = false
}

const counters = new Map<string, { hits: number; expiresAt: number }>()

function countInMemory(key: string, windowMs: number, now: number) {
  const seen = counters.get(key)
  if (!seen || seen.expiresAt <= now) {
    if (counters.size >= MEMORY_TRACKED_KEYS) {
      for (const [id, entry] of counters) {
        if (entry.expiresAt <= now) counters.delete(id)
      }
      // Still full of live windows: the oldest one gives way rather than
      // letting the map grow without a ceiling.
      if (counters.size >= MEMORY_TRACKED_KEYS) {
        const oldest = counters.keys().next()
        if (!oldest.done) counters.delete(oldest.value)
      }
    }
    counters.set(key, { hits: 1, expiresAt: now + windowMs })
    return 1
  }
  seen.hits += 1
  return seen.hits
}

async function count(key: string, windowMs: number) {
  const url = redisUrl()
  if (url && Date.now() >= unavailableUntil) {
    try {
      const redis = await connected(url)
      const hits = await withTimeout(
        redis.send('EVAL', [COUNT_SCRIPT, '1', key, String(windowMs)]),
        COMMAND_TIMEOUT_MS,
        'command',
      )
      warnedUnavailable = false
      return Number(hits)
    } catch (error) {
      if (!warnedUnavailable) {
        warnedUnavailable = true
        console.error('[rate-limit] counting in memory; Redis is unavailable:', error)
      }
      // Every request in the next few seconds skips the reach entirely rather
      // than queueing behind another connection attempt.
      unavailableUntil = Date.now() + UNAVAILABLE_COOLDOWN_MS
      client?.close()
      client = null
    }
  }
  return countInMemory(key, windowMs, Date.now())
}

/**
 * Counts one request against `identity` in `bucket` and says whether to serve
 * it. Buckets keep unrelated endpoints from spending each other's budget: a
 * user uploading assets should not be able to lock themselves out of signing in.
 */
export async function rateLimit(
  bucket: string,
  identity: string,
  rule: RateLimitRule,
): Promise<RateLimitDecision> {
  const hits = await count(`ratelimit:${bucket}:${identity}`, rule.windowMs)
  const remaining = Math.max(0, rule.limit - hits)
  return {
    ok: hits <= rule.limit,
    limit: rule.limit,
    remaining,
    retryAfterSeconds: Math.max(1, Math.ceil(rule.windowMs / 1_000)),
  }
}

export function rateLimitHeaders(decision: RateLimitDecision) {
  return {
    'Retry-After': String(decision.retryAfterSeconds),
    'X-RateLimit-Limit': String(decision.limit),
    'X-RateLimit-Remaining': String(decision.remaining),
  }
}

/** The 429 every HTTP surface hands back, so they all read the same. */
export function tooManyRequestsResponse(
  decision: RateLimitDecision,
  message = 'Too many requests. Try again shortly.',
) {
  return new Response(message, {
    status: 429,
    headers: { ...rateLimitHeaders(decision), 'Cache-Control': 'no-store' },
  })
}

/** Everyone a proxy could not name, sharing one bucket. */
export const UNKNOWN_ADDRESS = 'unknown'
let warnedUnknownAddress = false

/**
 * Who to count against when there is no session.
 *
 * The left-most `x-forwarded-for` entry is *not* the answer, however often it
 * is used as one. Proxies append to that header rather than replace it, so a
 * caller who sends one of their own stays at the front of the chain — and a
 * caller who varies it gets a fresh bucket per request, which is a rate limit
 * that limits nothing. Measured against production: 200 requests with a
 * rotating header spent 176 of their allowance, where 200 honest ones spent 42.
 *
 * Cloudflare fronts both public surfaces and overwrites `cf-connecting-ip` on
 * every proxied request, so that is the address to count. A single-entry
 * `x-forwarded-for` is taken as a fallback — one entry means no client
 * contributed to it — and anything else is nobody in particular.
 */
export function clientAddress(headers: Headers) {
  const connecting = headers.get('cf-connecting-ip')?.trim()
  if (connecting) return connecting

  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const entries = forwarded
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
    if (entries.length === 1 && entries[0]) return entries[0]
  }

  if (!warnedUnknownAddress) {
    warnedUnknownAddress = true
    console.warn(
      '[rate-limit] no trustworthy client address on this request; ' +
        'anonymous callers will share one bucket. Expected cf-connecting-ip.',
    )
  }
  return UNKNOWN_ADDRESS
}

/** A user id when the caller is signed in, their address when they are not. */
export function callerIdentity(headers: Headers, userId?: string | null) {
  return userId ? `user:${userId}` : `ip:${clientAddress(headers)}`
}

/**
 * The limits themselves, in one place so they can be read against each other.
 *
 * Each is set from what the product actually does at its busiest, with room on
 * top — a limit that trips during normal work is worse than no limit at all,
 * because the fix is always to raise it in a hurry.
 */
export const rateLimits = {
  /**
   * Password and email flows, per address. Sign-in, sign-up, password reset and
   * email verification are the endpoints worth guessing at, so they get a
   * tight budget of their own; everything else under `/api/auth` (session
   * reads, sign-out, OAuth callbacks) rides the looser one.
   */
  authSensitive: { limit: 12, windowMs: 5 * 60_000 },
  auth: { limit: 240, windowMs: 60_000 },

  /**
   * oRPC, per signed-in user. The editor flushes a canvas batch roughly every
   * 250ms while somebody is dragging, so one busy tab can hold ~240/min on its
   * own; this leaves room for a couple of tabs and the panels' own queries.
   */
  rpc: { limit: 900, windowMs: 60_000 },
  /** Anonymous oRPC — sign-in state, public design reads. */
  rpcAnonymous: { limit: 120, windowMs: 60_000 },

  /**
   * Minting a ticket costs a design lookup, a plan check and a branch check.
   * One socket needs a ticket every 15 minutes plus a few on reconnects.
   */
  realtimeTicket: { limit: 30, windowMs: 60_000 },
  /** Opening an event stream. Reconnects back off client-side. */
  canvasEvents: { limit: 60, windowMs: 60_000 },
  /**
   * Cursor frames on the fallback transport, throttled to one per 80ms in the
   * client — 750/min from a tab whose pointer never stops. Two such tabs is
   * already unusual, and a dropped frame costs nothing but a stale cursor.
   */
  canvasPresence: { limit: 1_500, windowMs: 60_000 },

  /** Authenticated asset reads. A design full of images loads many at once. */
  asset: { limit: 600, windowMs: 60_000 },
  /**
   * Handoff payloads and their assets, per address. The tokens are long and
   * random; this is what makes guessing at them pointless rather than slow.
   */
  handoff: { limit: 60, windowMs: 60_000 },
  /** GitHub OAuth and app-install round trips, per address. */
  github: { limit: 30, windowMs: 60_000 },
  /** GitHub's own webhook deliveries. Signed, so this is only a ceiling. */
  githubWebhook: { limit: 600, windowMs: 60_000 },

  /**
   * MCP tool calls, per account. Weekly quota is metered through Polar; this is
   * the burst guard underneath it, sized for an agent working at full tilt.
   */
  mcp: { limit: 240, windowMs: 60_000 },
  /**
   * Every MCP request, per address, checked before the access token is looked
   * up. Loose enough that a team behind one address never feels it, tight
   * enough that nobody gets an unbounded stream of token verifications.
   */
  mcpAddress: { limit: 600, windowMs: 60_000 },
  /**
   * Requests that turned out to carry no valid token, per address. A probe
   * pays for one lookup each until it has spent this, and nothing after.
   */
  mcpAnonymous: { limit: 60, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>
