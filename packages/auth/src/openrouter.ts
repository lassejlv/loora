import { and, eq } from 'drizzle-orm'
import { db } from '@loora/db'
import { aiProviderCredential } from '@loora/db/schema'

const OPENROUTER_PROVIDER = 'openrouter'
const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key'
const REQUEST_TIMEOUT_MS = 10_000

export class OpenRouterIntegrationError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'INVALID_KEY'
      | 'RATE_LIMITED'
      | 'UNAVAILABLE'
      | 'RECONNECT_REQUIRED'
      | 'NOT_CONFIGURED',
    readonly status?: number,
  ) {
    super(message)
  }
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const decoded = Buffer.from(value, 'base64url')
  const bytes = new Uint8Array(decoded.length)
  bytes.set(decoded)
  return bytes
}

async function encryptionKey(): Promise<CryptoKey> {
  const secret = (
    process.env.BETTER_AUTH_SECRET ??
    process.env.AUTH_SECRET ??
    ''
  ).trim()
  if (secret.length < 16) {
    throw new OpenRouterIntegrationError(
      'Server credential encryption is not configured.',
      'NOT_CONFIGURED',
    )
  }
  const raw = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`loora:openrouter-credential:${secret}`),
  )
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function encryptApiKey(apiKey: string, userId: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(`loora:openrouter:${userId}:v1`),
    },
    await encryptionKey(),
    new TextEncoder().encode(apiKey),
  )
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`
}

async function decryptApiKey(value: string, userId: string): Promise<string> {
  const [version, iv, ciphertext] = value.split('.')
  if (version !== 'v1' || !iv || !ciphertext) {
    throw new OpenRouterIntegrationError(
      'Reconnect OpenRouter to continue.',
      'RECONNECT_REQUIRED',
    )
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: fromBase64Url(iv),
        additionalData: new TextEncoder().encode(`loora:openrouter:${userId}:v1`),
      },
      await encryptionKey(),
      fromBase64Url(ciphertext),
    )
    return new TextDecoder().decode(plaintext)
  } catch (error) {
    if (error instanceof OpenRouterIntegrationError) throw error
    throw new OpenRouterIntegrationError(
      'Reconnect OpenRouter to continue.',
      'RECONNECT_REQUIRED',
    )
  }
}

function attributionHeaders() {
  const appUrl = process.env.BETTER_AUTH_URL?.trim()
  return {
    'X-OpenRouter-Title': 'Loora',
    ...(appUrl ? { 'HTTP-Referer': appUrl } : {}),
  }
}

export async function validateOpenRouterApiKey(apiKey: string): Promise<{ label: string | null }> {
  const key = apiKey.trim()
  if (key.length < 10 || key.length > 512) {
    throw new OpenRouterIntegrationError('Enter a valid OpenRouter API key.', 'INVALID_KEY')
  }

  let response: Response
  try {
    response = await fetch(OPENROUTER_KEY_URL, {
      headers: {
        Authorization: `Bearer ${key}`,
        ...attributionHeaders(),
      },
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new OpenRouterIntegrationError(
      'OpenRouter could not be reached. Try again.',
      'UNAVAILABLE',
    )
  }

  if (response.status === 401 || response.status === 403) {
    throw new OpenRouterIntegrationError(
      'OpenRouter rejected this API key.',
      'INVALID_KEY',
      response.status,
    )
  }
  if (response.status === 429) {
    throw new OpenRouterIntegrationError(
      'OpenRouter is rate limiting key checks. Try again shortly.',
      'RATE_LIMITED',
      response.status,
    )
  }
  if (!response.ok) {
    throw new OpenRouterIntegrationError(
      'OpenRouter could not verify this API key.',
      'UNAVAILABLE',
      response.status,
    )
  }

  const payload = await response.json().catch(() => null) as {
    data?: { label?: unknown }
  } | null
  return {
    label:
      typeof payload?.data?.label === 'string' && payload.data.label.trim()
        ? payload.data.label.trim().slice(0, 200)
        : null,
  }
}

export async function connectOpenRouter(userId: string, apiKey: string) {
  const key = apiKey.trim()
  const metadata = await validateOpenRouterApiKey(key)
  const encryptedApiKey = await encryptApiKey(key, userId)
  await db
    .insert(aiProviderCredential)
    .values({
      userId,
      provider: OPENROUTER_PROVIDER,
      encryptedApiKey,
      label: metadata.label,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [aiProviderCredential.userId, aiProviderCredential.provider],
      set: {
        encryptedApiKey,
        label: metadata.label,
        updatedAt: new Date(),
      },
    })
  return { connected: true as const, label: metadata.label }
}

export async function getOpenRouterStatus(userId: string) {
  const [credential] = await db
    .select({
      label: aiProviderCredential.label,
      updatedAt: aiProviderCredential.updatedAt,
    })
    .from(aiProviderCredential)
    .where(
      and(
        eq(aiProviderCredential.userId, userId),
        eq(aiProviderCredential.provider, OPENROUTER_PROVIDER),
      ),
    )
    .limit(1)
  return credential
    ? {
        connected: true as const,
        label: credential.label,
        updatedAt: credential.updatedAt,
      }
    : {
        connected: false as const,
        label: null,
        updatedAt: null,
      }
}

export async function getOpenRouterApiKey(userId: string): Promise<string> {
  const [credential] = await db
    .select({ encryptedApiKey: aiProviderCredential.encryptedApiKey })
    .from(aiProviderCredential)
    .where(
      and(
        eq(aiProviderCredential.userId, userId),
        eq(aiProviderCredential.provider, OPENROUTER_PROVIDER),
      ),
    )
    .limit(1)
  if (!credential) {
    throw new OpenRouterIntegrationError(
      'Connect OpenRouter in Settings before using this model.',
      'RECONNECT_REQUIRED',
    )
  }
  return decryptApiKey(credential.encryptedApiKey, userId)
}

export async function disconnectOpenRouter(userId: string) {
  await db
    .delete(aiProviderCredential)
    .where(
      and(
        eq(aiProviderCredential.userId, userId),
        eq(aiProviderCredential.provider, OPENROUTER_PROVIDER),
      ),
    )
  return { disconnected: true as const }
}
