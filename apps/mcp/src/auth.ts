import type { FetchImpl } from './env'

export type VerifiedSession = {
  userId: string
  accessTokenExpiresAt: number | null
}

export type AuthError = 'invalid-token' | 'unavailable'

type CachedSession = {
  session: VerifiedSession
  expiresAt: number
  generation: number
}

const AUTH_CACHE_MAX_ENTRIES = 1_000
const CLEANUP_BATCH_SIZE = 64

export class AuthVerifier {
  private readonly authUrl: string
  private readonly fetchImpl: FetchImpl
  private readonly timeoutMs: number
  private readonly cacheTtlMs: number
  private readonly entries = new Map<string, CachedSession>()
  private readonly order: Array<{ key: string; generation: number }> = []
  private nextGeneration = 0

  constructor(options: {
    authOrigin: string
    timeoutMs: number
    cacheTtlMs: number
    fetchImpl?: FetchImpl
  }) {
    this.authUrl = `${options.authOrigin.replace(/\/+$/, '')}/api/auth/mcp/get-session`
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs
    this.cacheTtlMs = options.cacheTtlMs
  }

  async getSession(headers: Headers): Promise<VerifiedSession> {
    const header = headers.get('authorization')
    if (!header) throw tokenError('invalid-token')
    const token = header.startsWith('Bearer ')
      ? header.slice('Bearer '.length).trim()
      : ''
    if (!token) throw tokenError('invalid-token')
    return this.verifyToken(token)
  }

  async verifyToken(token: string): Promise<VerifiedSession> {
    const key = await sha256Hex(token)
    const now = Date.now()
    if (this.cacheTtlMs > 0) {
      const cached = this.entries.get(key)
      if (cached && cached.expiresAt > now) return cached.session
    }

    let response: Response
    try {
      response = await this.fetchImpl(this.authUrl, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch {
      throw tokenError('unavailable')
    }

    if (response.status === 401 || response.status === 403) {
      throw tokenError('invalid-token')
    }
    if (!response.ok) throw tokenError('unavailable')

    let body: { userId?: unknown; accessTokenExpiresAt?: unknown }
    try {
      body = (await response.json()) as {
        userId?: unknown
        accessTokenExpiresAt?: unknown
      }
    } catch {
      throw tokenError('unavailable')
    }
    if (typeof body.userId !== 'string' || body.userId.length === 0) {
      throw tokenError('unavailable')
    }

    const accessTokenExpiresAt = parseExpiry(body.accessTokenExpiresAt)
    const session: VerifiedSession = {
      userId: body.userId,
      accessTokenExpiresAt,
    }
    if (this.cacheTtlMs === 0) return session

    const cacheDuration = accessTokenExpiresAt
      ? Math.max(0, Math.min(this.cacheTtlMs, accessTokenExpiresAt - now))
      : this.cacheTtlMs
    if (cacheDuration === 0) return session
    this.insert(key, session, now + cacheDuration)
    return session
  }

  private insert(key: string, session: VerifiedSession, expiresAt: number) {
    this.cleanup(Date.now())
    const existing = this.entries.get(key)
    if (existing) {
      existing.session = session
      existing.expiresAt = expiresAt
      return
    }
    while (this.entries.size >= AUTH_CACHE_MAX_ENTRIES) {
      if (!this.evictOldest()) break
    }
    const generation = this.nextGeneration
    this.nextGeneration = (this.nextGeneration + 1) >>> 0
    this.entries.set(key, { session, expiresAt, generation })
    this.order.push({ key, generation })
  }

  private cleanup(now: number) {
    for (let i = 0; i < CLEANUP_BATCH_SIZE; i += 1) {
      const front = this.order[0]
      if (!front) break
      const entry = this.entries.get(front.key)
      const remove =
        !entry || entry.generation !== front.generation || entry.expiresAt <= now
      if (!remove) break
      this.order.shift()
      if (entry && entry.generation === front.generation) {
        this.entries.delete(front.key)
      }
    }
  }

  private evictOldest() {
    while (this.order.length > 0) {
      const front = this.order.shift()
      if (!front) return false
      const entry = this.entries.get(front.key)
      if (entry && entry.generation === front.generation) {
        this.entries.delete(front.key)
        return true
      }
    }
    return false
  }
}

function parseExpiry(value: unknown) {
  if (typeof value !== 'string' || value.length === 0) return null
  const expiresAt = Date.parse(value)
  return Number.isNaN(expiresAt) ? null : expiresAt
}

function tokenError(code: AuthError): Error & { code: AuthError } {
  const error = new Error(code) as Error & { code: AuthError }
  error.code = code
  return error
}

export function authErrorCode(error: unknown): AuthError | null {
  if (!(error instanceof Error)) return null
  const code = (error as { code?: unknown }).code
  return code === 'invalid-token' || code === 'unavailable' ? code : null
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
