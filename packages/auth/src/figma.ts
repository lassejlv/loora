import { Buffer } from 'node:buffer'
import { eq } from 'drizzle-orm'
import { db } from '@loora/db'
import { figmaAccount } from '@loora/db/schema'

const FLOW_TTL_MS = 10 * 60 * 1000
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000
const FIGMA_SCOPE = 'file_content:read'

const figmaClientId = process.env.FIGMA_OAUTH_CLIENT_ID?.trim()
const figmaClientSecret = process.env.FIGMA_OAUTH_CLIENT_SECRET?.trim()
const figmaDataEncryptionKey = process.env.FIGMA_DATA_ENCRYPTION_KEY?.trim()

export const figmaEnabled = Boolean(
  figmaClientId && figmaClientSecret && figmaDataEncryptionKey,
)

export class FigmaIntegrationError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'NOT_CONFIGURED'
      | 'RECONNECT_REQUIRED'
      | 'ACCESS_DENIED'
      | 'RATE_LIMITED'
      | 'INVALID_FILE'
      | 'TOO_LARGE'
      | 'FIGMA_ERROR',
    readonly status?: number,
    readonly retryAfter?: number,
    readonly upgradeUrl?: string,
  ) {
    super(message)
  }
}

interface FigmaConfig {
  clientId: string
  clientSecret: string
  dataEncryptionKey: string
  origin: string
}

function getConfig(): FigmaConfig {
  if (!figmaEnabled) {
    throw new FigmaIntegrationError('Figma is not configured.', 'NOT_CONFIGURED')
  }
  const origin = process.env.BETTER_AUTH_URL?.trim()
  if (!origin) {
    throw new FigmaIntegrationError('BETTER_AUTH_URL is required.', 'NOT_CONFIGURED')
  }
  return {
    clientId: figmaClientId!,
    clientSecret: figmaClientSecret!,
    dataEncryptionKey: figmaDataEncryptionKey!,
    origin,
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

function randomValue(bytes = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)))
}

async function encryptionKey(): Promise<CryptoKey> {
  const raw = Buffer.from(getConfig().dataEncryptionKey, 'base64')
  if (raw.length !== 32) {
    throw new FigmaIntegrationError(
      'FIGMA_DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key.',
      'NOT_CONFIGURED',
    )
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function encrypt(value: string, purpose: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(`loora:figma:${purpose}:v1`),
    },
    await encryptionKey(),
    new TextEncoder().encode(value),
  )
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`
}

async function decrypt(value: string, purpose: string): Promise<string> {
  const [version, iv, ciphertext] = value.split('.')
  if (version !== 'v1' || !iv || !ciphertext) throw new Error('Invalid encrypted value')
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64Url(iv),
      additionalData: new TextEncoder().encode(`loora:figma:${purpose}:v1`),
    },
    await encryptionKey(),
    fromBase64Url(ciphertext),
  )
  return new TextDecoder().decode(plaintext)
}

export const figmaFlowCookie = 'loora_figma_oauth'

interface FigmaFlow {
  userId: string
  state: string
  verifier: string
  returnTo: string
  expiresAt: number
}

function safeReturnTo(value?: string): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return '/?figmaImport=true'
  }
  return value
}

function cookieHeader(value: string, maxAge: number): string {
  const secure = getConfig().origin.startsWith('https://') ? '; Secure' : ''
  return `${figmaFlowCookie}=${value}; Path=/api/figma; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

export function clearFigmaFlowCookie(): string {
  return cookieHeader('', 0)
}

function readCookie(header: string | null): string | null {
  if (!header) return null
  for (const entry of header.split(';')) {
    const [key, ...value] = entry.trim().split('=')
    if (key === figmaFlowCookie) return value.join('=')
  }
  return null
}

export async function createFigmaOAuthFlow(userId: string, returnTo?: string) {
  const config = getConfig()
  const state = randomValue()
  const verifier = randomValue()
  const challenge = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const flow: FigmaFlow = {
    userId,
    state,
    verifier,
    returnTo: safeReturnTo(returnTo),
    expiresAt: Date.now() + FLOW_TTL_MS,
  }
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: new URL('/api/figma/callback', config.origin).toString(),
    scope: FIGMA_SCOPE,
    state,
    response_type: 'code',
    code_challenge: base64Url(new Uint8Array(challenge)),
    code_challenge_method: 'S256',
  })
  return {
    url: `https://www.figma.com/oauth?${params}`,
    cookie: cookieHeader(
      await encrypt(JSON.stringify(flow), 'oauth-flow'),
      FLOW_TTL_MS / 1000,
    ),
  }
}

export async function verifyFigmaFlow(
  cookieHeaderValue: string | null,
  state: string | null,
  userId: string,
): Promise<FigmaFlow> {
  const encrypted = readCookie(cookieHeaderValue)
  if (!encrypted || !state) {
    throw new FigmaIntegrationError('Figma connection expired.', 'ACCESS_DENIED')
  }
  try {
    const flow = JSON.parse(await decrypt(encrypted, 'oauth-flow')) as FigmaFlow
    if (
      flow.state !== state ||
      flow.userId !== userId ||
      flow.expiresAt <= Date.now()
    ) {
      throw new Error('Invalid flow')
    }
    return { ...flow, returnTo: safeReturnTo(flow.returnTo) }
  } catch {
    throw new FigmaIntegrationError(
      'Figma connection could not be verified.',
      'ACCESS_DENIED',
    )
  }
}

interface FigmaTokenResponse {
  user_id_string?: string
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

interface StoredFigmaTokens {
  figmaUserId: string
  accessToken: string
  refreshToken: string | null
  accessTokenExpiresAt: Date | null
  scope: string
}

async function tokenRequest(params: URLSearchParams): Promise<FigmaTokenResponse> {
  const config = getConfig()
  const response = await fetch('https://api.figma.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  })
  const payload = (await response.json().catch(() => ({}))) as FigmaTokenResponse
  if (!response.ok || !payload.access_token) {
    throw new FigmaIntegrationError(
      payload.error_description || payload.error || 'Figma authorization failed.',
      'RECONNECT_REQUIRED',
      response.status,
    )
  }
  return payload
}

export async function exchangeFigmaCode(code: string, verifier: string): Promise<StoredFigmaTokens> {
  const config = getConfig()
  const payload = await tokenRequest(
    new URLSearchParams({
      redirect_uri: new URL('/api/figma/callback', config.origin).toString(),
      code,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  )
  if (!payload.user_id_string) {
    throw new FigmaIntegrationError('Figma did not identify the connected account.', 'FIGMA_ERROR')
  }
  return {
    figmaUserId: payload.user_id_string,
    accessToken: payload.access_token!,
    refreshToken: payload.refresh_token ?? null,
    accessTokenExpiresAt: payload.expires_in
      ? new Date(Date.now() + payload.expires_in * 1000)
      : null,
    scope: payload.scope || FIGMA_SCOPE,
  }
}

export async function saveFigmaAccount(userId: string, tokens: StoredFigmaTokens) {
  const values = {
    figmaUserId: tokens.figmaUserId,
    accessToken: await encrypt(tokens.accessToken, 'access-token'),
    refreshToken: tokens.refreshToken
      ? await encrypt(tokens.refreshToken, 'refresh-token')
      : null,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    scope: tokens.scope,
  }
  await db
    .insert(figmaAccount)
    .values({ userId, ...values })
    .onConflictDoUpdate({
      target: figmaAccount.userId,
      set: { ...values, updatedAt: new Date() },
    })
}

async function refreshFigmaAccessToken(userId: string, encryptedRefreshToken: string) {
  const payload = await tokenRequest(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: await decrypt(encryptedRefreshToken, 'refresh-token'),
    }),
  )
  const accessToken = payload.access_token!
  await db
    .update(figmaAccount)
    .set({
      accessToken: await encrypt(accessToken, 'access-token'),
      accessTokenExpiresAt: payload.expires_in
        ? new Date(Date.now() + payload.expires_in * 1000)
        : null,
      ...(payload.refresh_token
        ? { refreshToken: await encrypt(payload.refresh_token, 'refresh-token') }
        : {}),
      scope: payload.scope || FIGMA_SCOPE,
      updatedAt: new Date(),
    })
    .where(eq(figmaAccount.userId, userId))
  return accessToken
}

const pendingRefreshes = new Map<string, Promise<string>>()

function refreshFigmaAccessTokenOnce(userId: string, refreshToken: string) {
  const existing = pendingRefreshes.get(userId)
  if (existing) return existing
  const refresh = refreshFigmaAccessToken(userId, refreshToken)
  pendingRefreshes.set(userId, refresh)
  void refresh.finally(() => {
    if (pendingRefreshes.get(userId) === refresh) pendingRefreshes.delete(userId)
  }).catch(() => {})
  return refresh
}

export async function getFigmaAccessToken(userId: string): Promise<string> {
  const [account] = await db
    .select()
    .from(figmaAccount)
    .where(eq(figmaAccount.userId, userId))
    .limit(1)
  if (!account) {
    throw new FigmaIntegrationError('Connect Figma to continue.', 'RECONNECT_REQUIRED')
  }
  if (
    !account.accessTokenExpiresAt ||
    account.accessTokenExpiresAt.getTime() > Date.now() + TOKEN_REFRESH_SKEW_MS
  ) {
    return decrypt(account.accessToken, 'access-token')
  }
  if (!account.refreshToken) {
    throw new FigmaIntegrationError('Reconnect Figma to continue.', 'RECONNECT_REQUIRED')
  }
  return refreshFigmaAccessTokenOnce(userId, account.refreshToken)
}

export async function getFigmaStatus(userId: string) {
  const [account] = await db
    .select({ figmaUserId: figmaAccount.figmaUserId, scope: figmaAccount.scope })
    .from(figmaAccount)
    .where(eq(figmaAccount.userId, userId))
    .limit(1)
  return account
    ? { enabled: figmaEnabled, connected: true as const, account }
    : { enabled: figmaEnabled, connected: false as const, account: null }
}

export async function disconnectFigma(userId: string) {
  const deleted = await db
    .delete(figmaAccount)
    .where(eq(figmaAccount.userId, userId))
    .returning({ userId: figmaAccount.userId })
  return { disconnected: deleted.length > 0 }
}
