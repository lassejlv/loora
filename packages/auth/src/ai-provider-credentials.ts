import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@loora/db'
import { aiProviderCredential } from '@loora/db/schema'

export const CUSTOM_AI_PROVIDERS = ['google', 'openai', 'anthropic'] as const
export type CustomAiProvider = (typeof CUSTOM_AI_PROVIDERS)[number]

const REQUEST_TIMEOUT_MS = 10_000

const PROVIDER_CONFIG = {
  google: {
    label: 'Google Gemini',
    validationUrl:
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
    headers: (apiKey: string) => ({ 'x-goog-api-key': apiKey }),
  },
  openai: {
    label: 'OpenAI',
    validationUrl: 'https://api.openai.com/v1/models',
    headers: (apiKey: string) => ({ Authorization: `Bearer ${apiKey}` }),
  },
  anthropic: {
    label: 'Anthropic',
    validationUrl: 'https://api.anthropic.com/v1/models?limit=1',
    headers: (apiKey: string) => ({
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }),
  },
} as const satisfies Record<
  CustomAiProvider,
  {
    label: string
    validationUrl: string
    headers: (apiKey: string) => Record<string, string>
  }
>

export class AiProviderCredentialError extends Error {
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
    throw new AiProviderCredentialError(
      'Server credential encryption is not configured.',
      'NOT_CONFIGURED',
    )
  }
  const raw = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`loora:ai-provider-credential:${secret}`),
  )
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function encryptApiKey(
  provider: CustomAiProvider,
  apiKey: string,
  userId: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(`loora:${provider}:${userId}:v1`),
    },
    await encryptionKey(),
    new TextEncoder().encode(apiKey),
  )
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`
}

async function decryptApiKey(
  provider: CustomAiProvider,
  value: string,
  userId: string,
): Promise<string> {
  const [version, iv, ciphertext] = value.split('.')
  if (version !== 'v1' || !iv || !ciphertext) {
    throw new AiProviderCredentialError(
      `Reconnect ${PROVIDER_CONFIG[provider].label} to continue.`,
      'RECONNECT_REQUIRED',
    )
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: fromBase64Url(iv),
        additionalData: new TextEncoder().encode(`loora:${provider}:${userId}:v1`),
      },
      await encryptionKey(),
      fromBase64Url(ciphertext),
    )
    return new TextDecoder().decode(plaintext)
  } catch (error) {
    if (error instanceof AiProviderCredentialError) throw error
    throw new AiProviderCredentialError(
      `Reconnect ${PROVIDER_CONFIG[provider].label} to continue.`,
      'RECONNECT_REQUIRED',
    )
  }
}

export async function validateAiProviderApiKey(
  provider: CustomAiProvider,
  apiKey: string,
): Promise<void> {
  const config = PROVIDER_CONFIG[provider]
  const key = apiKey.trim()
  if (key.length < 10 || key.length > 512) {
    throw new AiProviderCredentialError(
      `Enter a valid ${config.label} API key.`,
      'INVALID_KEY',
    )
  }

  let response: Response
  try {
    response = await fetch(config.validationUrl, {
      headers: config.headers(key),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new AiProviderCredentialError(
      `${config.label} could not be reached. Try again.`,
      'UNAVAILABLE',
    )
  }

  if (response.status === 400 || response.status === 401 || response.status === 403) {
    throw new AiProviderCredentialError(
      `${config.label} rejected this API key.`,
      'INVALID_KEY',
      response.status,
    )
  }
  if (response.status === 429) {
    throw new AiProviderCredentialError(
      `${config.label} is rate limiting key checks. Try again shortly.`,
      'RATE_LIMITED',
      response.status,
    )
  }
  if (!response.ok) {
    throw new AiProviderCredentialError(
      `${config.label} could not verify this API key.`,
      'UNAVAILABLE',
      response.status,
    )
  }
}

export async function connectAiProvider(
  userId: string,
  provider: CustomAiProvider,
  apiKey: string,
) {
  const key = apiKey.trim()
  await validateAiProviderApiKey(provider, key)
  const encryptedApiKey = await encryptApiKey(provider, key, userId)
  await db
    .insert(aiProviderCredential)
    .values({
      userId,
      provider,
      encryptedApiKey,
      label: PROVIDER_CONFIG[provider].label,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [aiProviderCredential.userId, aiProviderCredential.provider],
      set: {
        encryptedApiKey,
        label: PROVIDER_CONFIG[provider].label,
        updatedAt: new Date(),
      },
    })
  return { connected: true as const }
}

export async function listAiProviderConnections(userId: string) {
  const credentials = await db
    .select({
      provider: aiProviderCredential.provider,
      updatedAt: aiProviderCredential.updatedAt,
    })
    .from(aiProviderCredential)
    .where(
      and(
        eq(aiProviderCredential.userId, userId),
        inArray(aiProviderCredential.provider, [...CUSTOM_AI_PROVIDERS]),
      ),
    )

  const byProvider = new Map(credentials.map((credential) => [
    credential.provider,
    credential.updatedAt,
  ]))
  return Object.fromEntries(
    CUSTOM_AI_PROVIDERS.map((provider) => [
      provider,
      {
        connected: byProvider.has(provider),
        updatedAt: byProvider.get(provider) ?? null,
      },
    ]),
  ) as Record<
    CustomAiProvider,
    { connected: boolean; updatedAt: Date | null }
  >
}

export async function getAiProviderConnection(
  userId: string,
  provider: CustomAiProvider,
) {
  const connections = await listAiProviderConnections(userId)
  return connections[provider]
}

export async function getAiProviderApiKey(
  userId: string,
  provider: CustomAiProvider,
): Promise<string> {
  const [credential] = await db
    .select({ encryptedApiKey: aiProviderCredential.encryptedApiKey })
    .from(aiProviderCredential)
    .where(
      and(
        eq(aiProviderCredential.userId, userId),
        eq(aiProviderCredential.provider, provider),
      ),
    )
    .limit(1)
  if (!credential) {
    throw new AiProviderCredentialError(
      `Connect ${PROVIDER_CONFIG[provider].label} in Settings before using this model.`,
      'RECONNECT_REQUIRED',
    )
  }
  return decryptApiKey(provider, credential.encryptedApiKey, userId)
}

export async function disconnectAiProvider(
  userId: string,
  provider: CustomAiProvider,
) {
  await db
    .delete(aiProviderCredential)
    .where(
      and(
        eq(aiProviderCredential.userId, userId),
        eq(aiProviderCredential.provider, provider),
      ),
    )
  return { disconnected: true as const }
}
