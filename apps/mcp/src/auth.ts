import {
  createMcpAuthClient,
  type McpSession,
} from 'better-auth/plugins/mcp/client'

export interface McpSessionVerifier {
  getSession: (headers: Headers) => Promise<McpSession | null>
}

type McpAuthFetch = (
  ...args: Parameters<typeof globalThis.fetch>
) => ReturnType<typeof globalThis.fetch>

function authTimeout() {
  const value = Number(process.env.MCP_AUTH_TIMEOUT_MS ?? 5_000)
  return Number.isInteger(value) && value >= 100 && value <= 30_000
    ? value
    : 5_000
}

function authCacheTtl() {
  const value = Number(process.env.MCP_AUTH_CACHE_TTL_MS ?? 60_000)
  return Number.isInteger(value) && value >= 0 && value <= 10 * 60_000
    ? value
    : 60_000
}

const AUTH_CACHE_MAX_ENTRIES = 1_000

interface CachedSession {
  session: McpSession
  expiresAt: number
}

async function tokenCacheKey(token: string) {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  )
  return Buffer.from(digest).toString('base64')
}

export function createMcpSessionVerifier(
  authOrigin: string,
  fetchImpl: McpAuthFetch = globalThis.fetch,
  timeoutMs = authTimeout(),
  cacheTtlMs = authCacheTtl(),
): McpSessionVerifier {
  const authURL = new URL('/api/auth', `${authOrigin.replace(/\/+$/, '')}/`).toString()
    .replace(/\/+$/, '')
  const timedFetch: McpAuthFetch = async (input, init) => {
    const controller = new AbortController()
    const callerSignal =
      init?.signal ??
      (input instanceof Request ? input.signal : undefined)
    const abortFromCaller = () => controller.abort(callerSignal?.reason)
    if (callerSignal?.aborted) abortFromCaller()
    else callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    timer.unref?.()
    try {
      return await fetchImpl(input, {
        ...init,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
      callerSignal?.removeEventListener('abort', abortFromCaller)
    }
  }
  const client = createMcpAuthClient({
    authURL,
    fetch: timedFetch as typeof globalThis.fetch,
  })

  // Verified sessions, keyed by token digest. Every MCP POST re-verifies its
  // bearer token against the web app, which costs a full HTTPS round trip
  // (multiple seconds when the web service is cold); a short cache keeps that
  // to one trip per token per minute. Only successes are cached, so a
  // rejected or expired token is always re-checked, and revocation lags by at
  // most the TTL.
  const cache = new Map<string, CachedSession>()

  return {
    async getSession(headers) {
      const authorization = headers.get('authorization')
      if (!authorization?.startsWith('Bearer ')) return null
      const token = authorization.slice('Bearer '.length)
      if (cacheTtlMs === 0) return client.verifyToken(token)

      const key = await tokenCacheKey(token)
      const now = Date.now()
      const cached = cache.get(key)
      if (cached && cached.expiresAt > now) return cached.session
      if (cached) cache.delete(key)

      const session = await client.verifyToken(token)
      if (!session) return null

      let expiresAt = now + cacheTtlMs
      if (session.accessTokenExpiresAt) {
        const tokenExpiry = new Date(session.accessTokenExpiresAt).getTime()
        if (Number.isFinite(tokenExpiry)) {
          expiresAt = Math.min(expiresAt, tokenExpiry)
        }
      }
      if (expiresAt <= now) return session

      if (cache.size >= AUTH_CACHE_MAX_ENTRIES) {
        for (const [staleKey, entry] of cache) {
          if (entry.expiresAt <= now) cache.delete(staleKey)
        }
        // Still full after sweeping: drop the oldest entries.
        while (cache.size >= AUTH_CACHE_MAX_ENTRIES) {
          const oldest = cache.keys().next().value
          if (oldest === undefined) break
          cache.delete(oldest)
        }
      }
      cache.set(key, { session, expiresAt })
      return session
    },
  }
}
