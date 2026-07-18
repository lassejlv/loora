import { createChatGPTHandler } from '@opencoredev/loginwithchatgpt-server'
import type { KeyValueStore } from '@opencoredev/loginwithchatgpt-core'
import { eq } from 'drizzle-orm'
import { db } from '#/db'
import { chatgptSession } from '#/db/schema'

// Postgres-backed session store so ChatGPT logins survive restarts and
// span instances. Values are already token-encrypted by the handler.
function createPostgresStore<T>(): KeyValueStore<T> {
  return {
    async get(key) {
      const [row] = await db
        .select({ value: chatgptSession.value, expiresAt: chatgptSession.expiresAt })
        .from(chatgptSession)
        .where(eq(chatgptSession.key, key))
        .limit(1)
      if (!row) return undefined
      if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
        await db.delete(chatgptSession).where(eq(chatgptSession.key, key))
        return undefined
      }
      return row.value as T
    },
    async set(key, value, options) {
      const expiresAt = options?.ttlMs ? new Date(Date.now() + options.ttlMs) : null
      await db
        .insert(chatgptSession)
        .values({ key, value: value as object, expiresAt })
        .onConflictDoUpdate({
          target: chatgptSession.key,
          set: { value: value as object, expiresAt, updatedAt: new Date() },
        })
    },
    async delete(key) {
      await db.delete(chatgptSession).where(eq(chatgptSession.key, key))
    },
  }
}

export const chatgptAuth = createChatGPTHandler({
  secret: process.env.LWC_SECRET,
  sessionStore: createPostgresStore(),
})
