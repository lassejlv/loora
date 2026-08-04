/**
 * Sign in with ChatGPT.
 *
 * One OAuth 2.0 authorization-code flow with PKCE against OpenAI's issuer, so a
 * Loora account can be bound to the ChatGPT account whose plan pays for
 * assistant runs. The OpenID `sub` claim is that binding: it is stored on
 * `chatgpt_account.chatgpt_user_id`, one row per Loora user, and reconnecting as
 * a different ChatGPT account replaces the row rather than adding a second one.
 *
 * Everything about the issuer is configuration. OpenAI does not publish a
 * fixed third-party client for this, so `CHATGPT_OAUTH_CLIENT_ID` is the client
 * *you* registered — nothing here is hardcoded to another product's client.
 */
import { eq } from 'drizzle-orm'
import { db } from '@loora/db'
import { chatgptAccount } from '@loora/db/schema'

const FLOW_TTL_MS = 10 * 60 * 1000
/** Refresh this far before expiry so a long run never dies mid-stream. */
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000

export const CHATGPT_FLOW_COOKIE = 'loora_chatgpt_flow'

const clientId = process.env.CHATGPT_OAUTH_CLIENT_ID?.trim()
const clientSecret = process.env.CHATGPT_OAUTH_CLIENT_SECRET?.trim()
const dataEncryptionKey = process.env.CHATGPT_DATA_ENCRYPTION_KEY?.trim()

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

const issuer = trimTrailingSlash(
  process.env.CHATGPT_OAUTH_ISSUER?.trim() || 'https://auth.openai.com',
)
const scope =
  process.env.CHATGPT_OAUTH_SCOPE?.trim() ||
  'openid profile email offline_access'

/**
 * Where the model is called. Defaults to the public API; point it at a
 * plan-backed endpoint when the issuer hands out credentials for one.
 */
export const chatgptApiBaseUrl = trimTrailingSlash(
  process.env.CHATGPT_API_BASE_URL?.trim() || 'https://api.openai.com/v1',
)

/**
 * Whether to trade the id_token for an inference credential. Issuers that
 * support it return a usable key; issuers that do not simply fail the exchange
 * and we fall back to the OAuth access token.
 */
const apiKeyExchangeEnabled =
  (process.env.CHATGPT_API_KEY_EXCHANGE?.trim() || 'true') !== 'false'

export const chatgptEnabled = Boolean(clientId && dataEncryptionKey)

export type ChatGptErrorCode =
  | 'NOT_CONFIGURED'
  | 'NOT_CONNECTED'
  | 'RECONNECT_REQUIRED'
  | 'ACCESS_DENIED'
  | 'PROVIDER_ERROR'

export class ChatGptError extends Error {
  constructor(
    message: string,
    readonly code: ChatGptErrorCode,
  ) {
    super(message)
  }
}

interface ChatGptConfig {
  clientId: string
  clientSecret?: string
  dataEncryptionKey: string
  origin: string
}

function getConfig(): ChatGptConfig {
  if (!chatgptEnabled) {
    throw new ChatGptError('ChatGPT sign-in is not configured.', 'NOT_CONFIGURED')
  }
  const origin = process.env.BETTER_AUTH_URL?.trim()
  if (!origin) {
    throw new ChatGptError('BETTER_AUTH_URL is required.', 'NOT_CONFIGURED')
  }
  return {
    clientId: clientId!,
    clientSecret,
    dataEncryptionKey: dataEncryptionKey!,
    origin: trimTrailingSlash(origin),
  }
}

export function chatgptRedirectUri(origin?: string) {
  return new URL(
    '/api/chatgpt/callback',
    `${origin ? trimTrailingSlash(origin) : getConfig().origin}/`,
  ).toString()
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

function randomValue(bytes = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)))
}

async function encryptionKey(): Promise<CryptoKey> {
  const raw = Buffer.from(getConfig().dataEncryptionKey, 'base64')
  if (raw.length !== 32) {
    throw new ChatGptError(
      'CHATGPT_DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key.',
      'NOT_CONFIGURED',
    )
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
}

async function encrypt(value: string, purpose: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(`loora:${purpose}:v1`),
    },
    await encryptionKey(),
    new TextEncoder().encode(value),
  )
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`
}

async function decrypt(value: string, purpose: string): Promise<string> {
  const [version, iv, ciphertext] = value.split('.')
  if (version !== 'v1' || !iv || !ciphertext) {
    throw new Error('Invalid encrypted value')
  }
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64Url(iv),
      additionalData: new TextEncoder().encode(`loora:${purpose}:v1`),
    },
    await encryptionKey(),
    fromBase64Url(ciphertext),
  )
  return new TextDecoder().decode(plaintext)
}

function cookieHeader(name: string, value: string, maxAgeSeconds: number) {
  const secure = getConfig().origin.startsWith('https://') ? '; Secure' : ''
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`
}

export function clearChatGptFlowCookie() {
  return cookieHeader(CHATGPT_FLOW_COOKIE, '', 0)
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const entry of header.split(';')) {
    const [key, ...value] = entry.trim().split('=')
    if (key === name) return value.join('=')
  }
  return null
}

interface ChatGptFlow {
  userId: string
  state: string
  verifier: string
  /** Where to send the browser once the connection lands. */
  returnTo: string
  expiresAt: number
}

/**
 * Only same-origin paths survive the round trip, so a crafted `returnTo` cannot
 * bounce somebody off to another site with a fresh session.
 */
export function safeReturnTo(value: string | null | undefined) {
  if (!value) return '/app/integrations'
  if (!value.startsWith('/') || value.startsWith('//')) return '/app/integrations'
  return value.slice(0, 512)
}

export async function createChatGptOAuthFlow(userId: string, returnTo?: string) {
  const config = getConfig()
  const state = randomValue()
  const verifier = randomValue()
  const challenge = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )
  const flow: ChatGptFlow = {
    userId,
    state,
    verifier,
    returnTo: safeReturnTo(returnTo),
    expiresAt: Date.now() + FLOW_TTL_MS,
  }
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: chatgptRedirectUri(config.origin),
    scope,
    state,
    code_challenge: base64Url(new Uint8Array(challenge)),
    code_challenge_method: 'S256',
  })
  return {
    url: `${issuer}/oauth/authorize?${params}`,
    cookie: cookieHeader(
      CHATGPT_FLOW_COOKIE,
      await encrypt(JSON.stringify(flow), 'chatgpt-flow'),
      FLOW_TTL_MS / 1000,
    ),
  }
}

export async function verifyChatGptFlow(
  cookieHeaderValue: string | null,
  state: string | null,
  userId: string,
): Promise<ChatGptFlow> {
  const encrypted = readCookie(cookieHeaderValue, CHATGPT_FLOW_COOKIE)
  if (!encrypted || !state) {
    throw new ChatGptError('The ChatGPT connection expired.', 'ACCESS_DENIED')
  }
  try {
    const flow = JSON.parse(
      await decrypt(encrypted, 'chatgpt-flow'),
    ) as ChatGptFlow
    if (
      flow.state !== state ||
      flow.userId !== userId ||
      flow.expiresAt <= Date.now()
    ) {
      throw new Error('Invalid flow')
    }
    return flow
  } catch {
    throw new ChatGptError(
      'The ChatGPT connection could not be verified.',
      'ACCESS_DENIED',
    )
  }
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  id_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const config = getConfig()
  const params = new URLSearchParams({ client_id: config.clientId, ...body })
  if (config.clientSecret) params.set('client_secret', config.clientSecret)
  const response = await fetch(`${issuer}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params,
  })
  const payload = (await response.json().catch(() => ({}))) as TokenResponse
  if (!response.ok || payload.error || !payload.access_token) {
    throw new ChatGptError(
      payload.error_description ||
        payload.error ||
        `ChatGPT token request failed (${response.status}).`,
      response.status === 400 || response.status === 401
        ? 'RECONNECT_REQUIRED'
        : 'PROVIDER_ERROR',
    )
  }
  return payload
}

export interface ChatGptIdentity {
  subject: string
  accountId: string | null
  email: string | null
  name: string | null
  avatarUrl: string | null
  planType: string | null
}

/**
 * The id_token comes straight back from the token endpoint over TLS in the
 * authorization-code flow, so its claims are read rather than re-verified —
 * the same rule OpenID Connect writes down for this exact case. It is never
 * accepted from a client.
 */
export function readIdTokenClaims(idToken: string): ChatGptIdentity | null {
  const payload = idToken.split('.')[1]
  if (!payload) return null
  try {
    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as Record<string, unknown>
    const subject = typeof claims.sub === 'string' ? claims.sub : null
    if (!subject) return null
    const authClaim = claims['https://api.openai.com/auth']
    const auth =
      authClaim && typeof authClaim === 'object'
        ? (authClaim as Record<string, unknown>)
        : {}
    const text = (value: unknown) =>
      typeof value === 'string' && value.length > 0 && value.length <= 512
        ? value
        : null
    return {
      subject,
      accountId: text(auth.chatgpt_account_id),
      email: text(claims.email),
      name: text(claims.name),
      avatarUrl: text(claims.picture),
      planType: text(auth.chatgpt_plan_type),
    }
  } catch {
    return null
  }
}

/**
 * Trade the identity token for an inference credential. Optional by design:
 * when the issuer does not implement RFC 8693 for this, the caller keeps using
 * the OAuth access token as the bearer instead.
 */
async function exchangeApiKey(idToken: string) {
  if (!apiKeyExchangeEnabled) return null
  try {
    const payload = await tokenRequest({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      requested_token: 'openai-api-key',
      subject_token: idToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
    })
    if (!payload.access_token) return null
    return {
      apiKey: payload.access_token,
      expiresAt: payload.expires_in
        ? new Date(Date.now() + payload.expires_in * 1000)
        : null,
    }
  } catch {
    return null
  }
}

async function saveConnection(
  userId: string,
  identity: ChatGptIdentity,
  tokens: {
    accessToken: string
    accessTokenExpiresAt: Date | null
    refreshToken: string | null
    apiKey: string | null
    apiKeyExpiresAt: Date | null
  },
) {
  const values = {
    chatgptUserId: identity.subject,
    chatgptAccountId: identity.accountId,
    email: identity.email,
    name: identity.name,
    avatarUrl: identity.avatarUrl,
    planType: identity.planType,
    accessToken: await encrypt(tokens.accessToken, 'chatgpt-access-token'),
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    refreshToken: tokens.refreshToken
      ? await encrypt(tokens.refreshToken, 'chatgpt-refresh-token')
      : null,
    apiKey: tokens.apiKey
      ? await encrypt(tokens.apiKey, 'chatgpt-api-key')
      : null,
    apiKeyExpiresAt: tokens.apiKeyExpiresAt,
  }
  await db
    .insert(chatgptAccount)
    .values({ userId, ...values })
    .onConflictDoUpdate({
      target: chatgptAccount.userId,
      set: { ...values, updatedAt: new Date() },
    })
}

export async function completeChatGptOAuth(input: {
  userId: string
  code: string
  verifier: string
}) {
  const payload = await tokenRequest({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: chatgptRedirectUri(),
    code_verifier: input.verifier,
  })
  const identity = payload.id_token ? readIdTokenClaims(payload.id_token) : null
  if (!identity) {
    throw new ChatGptError(
      'ChatGPT did not return an identity token.',
      'PROVIDER_ERROR',
    )
  }
  const exchanged = payload.id_token ? await exchangeApiKey(payload.id_token) : null
  await saveConnection(input.userId, identity, {
    accessToken: payload.access_token!,
    accessTokenExpiresAt: payload.expires_in
      ? new Date(Date.now() + payload.expires_in * 1000)
      : null,
    refreshToken: payload.refresh_token ?? null,
    apiKey: exchanged?.apiKey ?? null,
    apiKeyExpiresAt: exchanged?.expiresAt ?? null,
  })
  return identity
}

export interface ChatGptConnection {
  connected: true
  subject: string
  accountId: string | null
  email: string | null
  name: string | null
  avatarUrl: string | null
  planType: string | null
  connectedAt: string
}

/** The connection as the product may show it. Never carries a credential. */
export async function getChatGptConnection(
  userId: string,
): Promise<ChatGptConnection | null> {
  const [found] = await db
    .select({
      subject: chatgptAccount.chatgptUserId,
      accountId: chatgptAccount.chatgptAccountId,
      email: chatgptAccount.email,
      name: chatgptAccount.name,
      avatarUrl: chatgptAccount.avatarUrl,
      planType: chatgptAccount.planType,
      createdAt: chatgptAccount.createdAt,
    })
    .from(chatgptAccount)
    .where(eq(chatgptAccount.userId, userId))
    .limit(1)
  if (!found) return null
  return {
    connected: true,
    subject: found.subject,
    accountId: found.accountId,
    email: found.email,
    name: found.name,
    avatarUrl: found.avatarUrl,
    planType: found.planType,
    connectedAt: found.createdAt.toISOString(),
  }
}

export async function disconnectChatGpt(userId: string) {
  await db.delete(chatgptAccount).where(eq(chatgptAccount.userId, userId))
}

export interface ChatGptCredentials {
  apiKey: string
  baseUrl: string
  chatgptAccountId: string | null
  /** True when the bearer is an exchanged inference key, not the raw session. */
  exchanged: boolean
}

/**
 * The credential an assistant run should use, refreshed if it is close to
 * expiring. Throws `RECONNECT_REQUIRED` rather than returning a dead token, so
 * the editor can say exactly what the person has to do.
 */
export async function resolveChatGptCredentials(
  userId: string,
): Promise<ChatGptCredentials> {
  const [found] = await db
    .select()
    .from(chatgptAccount)
    .where(eq(chatgptAccount.userId, userId))
    .limit(1)
  if (!found) {
    throw new ChatGptError('Connect ChatGPT to use the agent.', 'NOT_CONNECTED')
  }

  const now = Date.now()
  const apiKeyUsable =
    found.apiKey &&
    (!found.apiKeyExpiresAt ||
      found.apiKeyExpiresAt.getTime() - TOKEN_REFRESH_SKEW_MS > now)
  if (apiKeyUsable) {
    return {
      apiKey: await decrypt(found.apiKey!, 'chatgpt-api-key'),
      baseUrl: chatgptApiBaseUrl,
      chatgptAccountId: found.chatgptAccountId,
      exchanged: true,
    }
  }

  const accessUsable =
    !found.accessTokenExpiresAt ||
    found.accessTokenExpiresAt.getTime() - TOKEN_REFRESH_SKEW_MS > now
  if (accessUsable && !found.apiKey) {
    return {
      apiKey: await decrypt(found.accessToken, 'chatgpt-access-token'),
      baseUrl: chatgptApiBaseUrl,
      chatgptAccountId: found.chatgptAccountId,
      exchanged: false,
    }
  }

  if (!found.refreshToken) {
    throw new ChatGptError(
      'The ChatGPT connection expired. Reconnect to keep using the agent.',
      'RECONNECT_REQUIRED',
    )
  }

  const payload = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: await decrypt(found.refreshToken, 'chatgpt-refresh-token'),
    scope,
  })
  const identity = payload.id_token
    ? readIdTokenClaims(payload.id_token)
    : null
  const exchanged = payload.id_token ? await exchangeApiKey(payload.id_token) : null
  await saveConnection(
    userId,
    identity ?? {
      subject: found.chatgptUserId,
      accountId: found.chatgptAccountId,
      email: found.email,
      name: found.name,
      avatarUrl: found.avatarUrl,
      planType: found.planType,
    },
    {
      accessToken: payload.access_token!,
      accessTokenExpiresAt: payload.expires_in
        ? new Date(Date.now() + payload.expires_in * 1000)
        : null,
      // Issuers that rotate refresh tokens send a new one; the rest keep theirs.
      refreshToken:
        payload.refresh_token ??
        (await decrypt(found.refreshToken, 'chatgpt-refresh-token')),
      apiKey: exchanged?.apiKey ?? null,
      apiKeyExpiresAt: exchanged?.expiresAt ?? null,
    },
  )
  return {
    apiKey: exchanged?.apiKey ?? payload.access_token!,
    baseUrl: chatgptApiBaseUrl,
    chatgptAccountId: identity?.accountId ?? found.chatgptAccountId,
    exchanged: Boolean(exchanged),
  }
}
