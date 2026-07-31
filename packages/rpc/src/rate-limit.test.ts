import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  callerIdentity,
  clientAddress,
  rateLimit,
  rateLimitHeaders,
  rateLimits,
  resetRateLimitClient,
  tooManyRequestsResponse,
} from './rate-limit'

// No Redis in the suite: these cover the in-memory path every deployment falls
// back to, which is the one that has to stay correct when Redis is missing.
const url = process.env.REDIS_RATELIMIT_URL

beforeEach(() => {
  delete process.env.REDIS_RATELIMIT_URL
  resetRateLimitClient()
})

afterEach(() => {
  if (url === undefined) delete process.env.REDIS_RATELIMIT_URL
  else process.env.REDIS_RATELIMIT_URL = url
})

function identity(name: string) {
  return `${name}-${Math.random()}`
}

describe('rateLimit', () => {
  it('serves a caller up to the limit and refuses the next request', async () => {
    const who = identity('caller')
    const rule = { limit: 3, windowMs: 60_000 }

    expect((await rateLimit('test', who, rule)).ok).toBe(true)
    expect((await rateLimit('test', who, rule)).ok).toBe(true)
    const last = await rateLimit('test', who, rule)
    expect(last.ok).toBe(true)
    expect(last.remaining).toBe(0)

    const refused = await rateLimit('test', who, rule)
    expect(refused.ok).toBe(false)
    expect(refused.remaining).toBe(0)
    expect(refused.retryAfterSeconds).toBe(60)
  })

  it('counts each caller on its own', async () => {
    const rule = { limit: 1, windowMs: 60_000 }
    const first = identity('first')
    const second = identity('second')

    expect((await rateLimit('test', first, rule)).ok).toBe(true)
    expect((await rateLimit('test', first, rule)).ok).toBe(false)
    expect((await rateLimit('test', second, rule)).ok).toBe(true)
  })

  it('keeps buckets apart so one endpoint cannot spend the budget of another', async () => {
    const who = identity('caller')
    const rule = { limit: 1, windowMs: 60_000 }

    expect((await rateLimit('bucket-a', who, rule)).ok).toBe(true)
    expect((await rateLimit('bucket-a', who, rule)).ok).toBe(false)
    expect((await rateLimit('bucket-b', who, rule)).ok).toBe(true)
  })

  it('keeps counting when Redis cannot be reached', async () => {
    // Nothing is listening on port 1, so this is what an outage looks like:
    // the limiter has to keep answering, and keep counting, without it.
    process.env.REDIS_RATELIMIT_URL = 'redis://127.0.0.1:1'
    resetRateLimitClient()
    const who = identity('caller')
    const rule = { limit: 1, windowMs: 60_000 }

    const startedAt = Date.now()
    expect((await rateLimit('test', who, rule)).ok).toBe(true)
    expect((await rateLimit('test', who, rule)).ok).toBe(false)
    // The second request must not queue behind another connection attempt.
    expect(Date.now() - startedAt).toBeLessThan(4_000)
  })

  it('serves the caller again once the window has rolled', async () => {
    const who = identity('caller')
    const rule = { limit: 1, windowMs: 10 }

    expect((await rateLimit('test', who, rule)).ok).toBe(true)
    expect((await rateLimit('test', who, rule)).ok).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 15))
    expect((await rateLimit('test', who, rule)).ok).toBe(true)
  })
})

describe('clientAddress', () => {
  it('takes the left-most forwarded address, which the proxy appended to', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })
    expect(clientAddress(headers)).toBe('203.0.113.7')
  })

  it('falls back to the other proxy headers, then to a placeholder', () => {
    expect(clientAddress(new Headers({ 'x-real-ip': '198.51.100.4' }))).toBe(
      '198.51.100.4',
    )
    expect(clientAddress(new Headers())).toBe('unknown')
  })
})

describe('callerIdentity', () => {
  it('counts a signed-in caller as themselves, not as their address', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7' })
    expect(callerIdentity(headers, 'user_1')).toBe('user:user_1')
    expect(callerIdentity(headers)).toBe('ip:203.0.113.7')
  })
})

describe('tooManyRequestsResponse', () => {
  it('answers 429 with the headers a client needs to back off', async () => {
    const response = tooManyRequestsResponse({
      ok: false,
      limit: 30,
      remaining: 0,
      retryAfterSeconds: 60,
    })

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(response.headers.get('X-RateLimit-Limit')).toBe('30')
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0')
    expect(await response.text()).toContain('Too many requests')
  })

  it('reports the same numbers through the header helper', () => {
    expect(
      rateLimitHeaders({ ok: true, limit: 10, remaining: 4, retryAfterSeconds: 1 }),
    ).toEqual({
      'Retry-After': '1',
      'X-RateLimit-Limit': '10',
      'X-RateLimit-Remaining': '4',
    })
  })
})

describe('rateLimits', () => {
  it('leaves room for what the editor actually sends', () => {
    // One tab flushes a canvas batch about every 250ms and posts a cursor
    // every 80ms on the fallback transport. A limit under either of those
    // would trip during ordinary work.
    expect(rateLimits.rpc.limit).toBeGreaterThan(240)
    expect(rateLimits.canvasPresence.limit).toBeGreaterThan(750)
    for (const rule of Object.values(rateLimits)) {
      expect(rule.limit).toBeGreaterThan(0)
      expect(rule.windowMs).toBeGreaterThan(0)
    }
  })
})
