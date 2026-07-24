import { createClient } from 'redis'
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from 'resumable-stream'

// Resumable chat streams are optional infrastructure: without REDIS_URL every
// helper below returns null and a page reload falls back to client-side tool
// recovery only (the generation itself is lost mid-stream).

// Slightly above the 300s generation abort so a key never outlives its stream
// by much, but always covers a full generation.
const ACTIVE_STREAM_TTL_SECONDS = 6 * 60

let context: ResumableStreamContext | null = null
let keyClient: ReturnType<typeof createClient> | null = null

function redisUrl() {
  return process.env.REDIS_URL
}

// node-redis queues commands issued before connect() resolves, so callers can
// use the client immediately.
function getKeyClient() {
  const url = redisUrl()
  if (!url) return null
  if (!keyClient) {
    keyClient = createClient({ url })
    keyClient.on('error', (error) => console.error('[resume] Redis error:', error))
    void keyClient.connect().catch((error) => {
      console.error('[resume] Redis connect failed:', error)
      keyClient = null
    })
  }
  return keyClient
}

export function getStreamContext() {
  if (!redisUrl()) return null
  if (!context) {
    // waitUntil: null — this is a long-lived Bun server, not a suspendable
    // serverless function, so nothing needs to keep the process alive.
    context = createResumableStreamContext({ waitUntil: null })
  }
  return context
}

const activeStreamKey = (chatId: string) => `loora:chat-stream:${chatId}`

export async function setActiveStream(chatId: string, streamId: string) {
  const client = getKeyClient()
  if (!client) return
  await client.set(activeStreamKey(chatId), streamId, { EX: ACTIVE_STREAM_TTL_SECONDS })
}

export async function getActiveStream(chatId: string) {
  const client = getKeyClient()
  if (!client) return null
  return client.get(activeStreamKey(chatId))
}

export async function clearActiveStream(chatId: string) {
  const client = getKeyClient()
  if (!client) return
  await client.del(activeStreamKey(chatId))
}
