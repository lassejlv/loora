import {
  createChatGPTHandler,
  type KeyValueStore,
  type RateLimitBucket,
  type StoredSession,
} from '@opencoredev/loginwithchatgpt-server'
import { eq } from 'drizzle-orm'
import { db } from '@loora/db'
import { chatgptSession } from '@loora/db/schema'

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const secret = process.env.LWC_SECRET?.trim()

class PostgresStore<T> implements KeyValueStore<T> {
  constructor(private readonly prefix: string) {}

  private key(key: string) {
    return `${this.prefix}:${key}`
  }

  async get(key: string): Promise<T | undefined> {
    const storageKey = this.key(key)
    const [row] = await db
      .select({ value: chatgptSession.value, expiresAt: chatgptSession.expiresAt })
      .from(chatgptSession)
      .where(eq(chatgptSession.key, storageKey))
      .limit(1)

    if (!row) return undefined
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      await db.delete(chatgptSession).where(eq(chatgptSession.key, storageKey))
      return undefined
    }
    return row.value as T
  }

  async set(
    key: string,
    value: T,
    options: { ttlMs?: number } = {},
  ): Promise<void> {
    const storageKey = this.key(key)
    const expiresAt = options.ttlMs
      ? new Date(Date.now() + options.ttlMs)
      : null
    await db
      .insert(chatgptSession)
      .values({ key: storageKey, value, expiresAt })
      .onConflictDoUpdate({
        target: chatgptSession.key,
        set: { value, expiresAt, updatedAt: new Date() },
      })
  }

  async delete(key: string): Promise<void> {
    await db.delete(chatgptSession).where(eq(chatgptSession.key, this.key(key)))
  }
}

if (process.env.NODE_ENV === 'production' && !secret) {
  throw new Error('LWC_SECRET is required in production')
}

export const chatgptEnabled = Boolean(secret || process.env.NODE_ENV !== 'production')

export const chatgptAuth = createChatGPTHandler({
  secret,
  clientVersion: process.env.CODEX_CLIENT_VERSION?.trim() || '0.145.0',
  sessionTtlMs: SESSION_TTL_MS,
  sessionStore: new PostgresStore<StoredSession>('session'),
  responsesProxy: {
    rateLimit: {
      store: new PostgresStore<RateLimitBucket>('rate'),
    },
  },
})
