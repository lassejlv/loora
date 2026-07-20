import {
  createChatGPTHandler,
  type KeyValueStore,
  type RateLimitBucket,
  type StoredSession,
} from '@opencoredev/loginwithchatgpt-server'
import { eq } from 'drizzle-orm'
import { db } from '#/db'
import { chatgptSession } from '#/db/schema'

const CHATGPT_MODEL = 'gpt-5.6-sol'
// OpenAI gates newly released Codex models by the reported client version.
// Keep this overridable so production can move forward without a code release.
const CODEX_CLIENT_VERSION = process.env.CODEX_CLIENT_VERSION?.trim() || '0.145.0'

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

  async set(key: string, value: T, options: { ttlMs?: number } = {}): Promise<void> {
    const storageKey = this.key(key)
    const expiresAt = options.ttlMs ? new Date(Date.now() + options.ttlMs) : null
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

const secret = process.env.LWC_SECRET?.trim()
if (process.env.NODE_ENV === 'production' && !secret) {
  throw new Error('LWC_SECRET is required in production')
}

export const chatgptAuth = createChatGPTHandler({
  secret,
  clientVersion: CODEX_CLIENT_VERSION,
  defaultModel: CHATGPT_MODEL,
  sessionStore: new PostgresStore<StoredSession>('session'),
  responsesProxy: {
    allowedModels: [CHATGPT_MODEL],
    rateLimit: {
      store: new PostgresStore<RateLimitBucket>('rate'),
    },
  },
})
