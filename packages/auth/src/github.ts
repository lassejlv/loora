import { timingSafeEqual } from 'node:crypto'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '@loora/db'
import {
  designGithubRepository,
  githubAccount,
  githubInstallation,
} from '@loora/db/schema'

const GITHUB_API_VERSION = '2026-03-10'
const FLOW_TTL_MS = 10 * 60 * 1000
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000
const MAX_TEXT_FILE_BYTES = 1024 * 1024
const MAX_IMAGE_BYTES = 4 * 1024 * 1024

const githubClientId = process.env.GITHUB_APP_CLIENT_ID?.trim()
const githubClientSecret = process.env.GITHUB_APP_CLIENT_SECRET?.trim()
const githubAppSlug = process.env.GITHUB_APP_SLUG?.trim()
const githubWebhookSecret = process.env.GITHUB_WEBHOOK_SECRET?.trim()
const githubDataEncryptionKey = process.env.GITHUB_DATA_ENCRYPTION_KEY?.trim()

export const githubEnabled = Boolean(
  githubClientId &&
  githubClientSecret &&
  githubAppSlug &&
  githubWebhookSecret &&
  githubDataEncryptionKey,
)

export class GitHubIntegrationError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'NOT_CONFIGURED'
      | 'RECONNECT_REQUIRED'
      | 'ACCESS_DENIED'
      | 'RATE_LIMITED'
      | 'INVALID_PATH'
      | 'SENSITIVE_PATH'
      | 'UNSUPPORTED_FILE'
      | 'TOO_LARGE'
      | 'GITHUB_ERROR',
    readonly status?: number,
  ) {
    super(message)
  }
}

interface GitHubConfig {
  clientId: string
  clientSecret: string
  appSlug: string
  webhookSecret: string
  dataEncryptionKey: string
  origin: string
}

function getConfig(): GitHubConfig {
  if (!githubEnabled) {
    throw new GitHubIntegrationError('GitHub is not configured.', 'NOT_CONFIGURED')
  }
  const origin = process.env.BETTER_AUTH_URL?.trim()
  if (!origin) throw new GitHubIntegrationError('BETTER_AUTH_URL is required.', 'NOT_CONFIGURED')
  return {
    clientId: githubClientId!,
    clientSecret: githubClientSecret!,
    appSlug: githubAppSlug!,
    webhookSecret: githubWebhookSecret!,
    dataEncryptionKey: githubDataEncryptionKey!,
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
    throw new GitHubIntegrationError(
      'GITHUB_DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key.',
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
      additionalData: new TextEncoder().encode(`loora:${purpose}:v1`),
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
      additionalData: new TextEncoder().encode(`loora:${purpose}:v1`),
    },
    await encryptionKey(),
    fromBase64Url(ciphertext),
  )
  return new TextDecoder().decode(plaintext)
}

export const githubFlowCookie = {
  oauth: 'loora_github_oauth',
  install: 'loora_github_install',
} as const

interface GitHubFlow {
  userId: string
  state: string
  purpose: 'oauth' | 'install'
  verifier?: string
  expiresAt: number
}

function cookieHeader(name: string, value: string, maxAge: number): string {
  const secure = getConfig().origin.startsWith('https://') ? '; Secure' : ''
  return `${name}=${value}; Path=/api/github; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

export function clearGitHubFlowCookie(name: string): string {
  return cookieHeader(name, '', 0)
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const entry of header.split(';')) {
    const [key, ...value] = entry.trim().split('=')
    if (key === name) return value.join('=')
  }
  return null
}

export async function createGitHubOAuthFlow(userId: string) {
  const config = getConfig()
  const state = randomValue()
  const verifier = randomValue()
  const challengeBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const flow: GitHubFlow = {
    userId,
    state,
    verifier,
    purpose: 'oauth',
    expiresAt: Date.now() + FLOW_TTL_MS,
  }
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: new URL('/api/github/callback', config.origin).toString(),
    state,
    code_challenge: base64Url(new Uint8Array(challengeBytes)),
    code_challenge_method: 'S256',
  })
  return {
    url: `https://github.com/login/oauth/authorize?${params}`,
    cookie: cookieHeader(
      githubFlowCookie.oauth,
      await encrypt(JSON.stringify(flow), 'oauth-flow'),
      FLOW_TTL_MS / 1000,
    ),
  }
}

export async function createGitHubInstallFlow(userId: string) {
  const config = getConfig()
  const flow: GitHubFlow = {
    userId,
    state: randomValue(),
    purpose: 'install',
    expiresAt: Date.now() + FLOW_TTL_MS,
  }
  return {
    url: `https://github.com/apps/${encodeURIComponent(config.appSlug)}/installations/new?state=${encodeURIComponent(flow.state)}`,
    cookie: cookieHeader(
      githubFlowCookie.install,
      await encrypt(JSON.stringify(flow), 'install-flow'),
      FLOW_TTL_MS / 1000,
    ),
  }
}

export async function verifyGitHubFlow(
  cookieHeaderValue: string | null,
  cookieName: string,
  purpose: GitHubFlow['purpose'],
  state: string | null,
  userId: string,
): Promise<GitHubFlow> {
  const encrypted = readCookie(cookieHeaderValue, cookieName)
  if (!encrypted || !state) throw new GitHubIntegrationError('GitHub connection expired.', 'ACCESS_DENIED')
  try {
    const flow = JSON.parse(
      await decrypt(encrypted, purpose === 'oauth' ? 'oauth-flow' : 'install-flow'),
    ) as GitHubFlow
    if (
      flow.purpose !== purpose ||
      flow.state !== state ||
      flow.userId !== userId ||
      flow.expiresAt <= Date.now()
    ) {
      throw new Error('Invalid flow')
    }
    return flow
  } catch {
    throw new GitHubIntegrationError('GitHub connection could not be verified.', 'ACCESS_DENIED')
  }
}

interface GitHubTokenResponse {
  access_token: string
  expires_in?: number
  refresh_token?: string
  refresh_token_expires_in?: number
  error?: string
  error_description?: string
}

interface StoredGitHubTokens {
  accessToken: string
  accessTokenExpiresAt: Date | null
  refreshToken: string | null
  refreshTokenExpiresAt: Date | null
}

async function tokenRequest(params: URLSearchParams): Promise<GitHubTokenResponse> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  })
  const payload = (await response.json()) as GitHubTokenResponse
  if (!response.ok || !payload.access_token) {
    throw new GitHubIntegrationError(
      payload.error_description || payload.error || 'GitHub authorization failed.',
      'RECONNECT_REQUIRED',
      response.status,
    )
  }
  return payload
}

function tokenDates(payload: GitHubTokenResponse): StoredGitHubTokens {
  return {
    accessToken: payload.access_token,
    accessTokenExpiresAt: payload.expires_in
      ? new Date(Date.now() + payload.expires_in * 1000)
      : null,
    refreshToken: payload.refresh_token ?? null,
    refreshTokenExpiresAt: payload.refresh_token_expires_in
      ? new Date(Date.now() + payload.refresh_token_expires_in * 1000)
      : null,
  }
}

export async function exchangeGitHubCode(code: string, verifier: string) {
  const config = getConfig()
  return tokenDates(
    await tokenRequest(
      new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        code_verifier: verifier,
        redirect_uri: new URL('/api/github/callback', config.origin).toString(),
      }),
    ),
  )
}

interface GitHubApiError {
  message?: string
}

async function githubRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'loora',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      ...init.headers,
    },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as GitHubApiError
    const remaining = response.headers.get('x-ratelimit-remaining')
    if (response.status === 403 && remaining === '0') {
      throw new GitHubIntegrationError('GitHub rate limit reached. Try again shortly.', 'RATE_LIMITED', 403)
    }
    if (response.status === 401) {
      throw new GitHubIntegrationError('Reconnect GitHub to continue.', 'RECONNECT_REQUIRED', 401)
    }
    if (response.status === 403 || response.status === 404) {
      throw new GitHubIntegrationError('This repository is no longer accessible.', 'ACCESS_DENIED', response.status)
    }
    throw new GitHubIntegrationError(
      payload.message || 'GitHub request failed.',
      'GITHUB_ERROR',
      response.status,
    )
  }
  return response.json() as Promise<T>
}

interface GitHubUserPayload {
  id: number
  login: string
  avatar_url: string | null
}

interface GitHubInstallationPayload {
  id: number
  target_id: number
  target_type: string
  account: { login: string; avatar_url?: string | null }
  repository_selection: string
  suspended_at?: string | null
}

interface GitHubRepositoryPayload {
  id: number
  name: string
  full_name: string
  private: boolean
  archived: boolean
  default_branch: string
  updated_at: string | null
  owner: { login: string }
}

async function pagedGitHubRequest<T>(path: string, token: string, key: string): Promise<T[]> {
  const items: T[] = []
  for (let page = 1; page <= 10; page++) {
    const separator = path.includes('?') ? '&' : '?'
    const payload = await githubRequest<Record<string, unknown>>(
      `${path}${separator}per_page=100&page=${page}`,
      token,
    )
    const batch = (payload[key] ?? payload) as T[]
    items.push(...batch)
    if (batch.length < 100) break
  }
  return items
}

export async function getGitHubUser(token: string): Promise<GitHubUserPayload> {
  return githubRequest('/user', token)
}

async function listInstallations(token: string): Promise<GitHubInstallationPayload[]> {
  return pagedGitHubRequest('/user/installations', token, 'installations')
}

async function listInstallationRepositories(
  token: string,
  installationId: string,
): Promise<GitHubRepositoryPayload[]> {
  return pagedGitHubRequest(
    `/user/installations/${encodeURIComponent(installationId)}/repositories`,
    token,
    'repositories',
  )
}

export async function saveGitHubAccount(
  userId: string,
  profile: GitHubUserPayload,
  tokens: StoredGitHubTokens,
) {
  const [existing] = await db
    .select({ githubUserId: githubAccount.githubUserId })
    .from(githubAccount)
    .where(eq(githubAccount.userId, userId))
    .limit(1)

  if (existing && existing.githubUserId !== String(profile.id)) {
    await db.delete(githubAccount).where(eq(githubAccount.userId, userId))
  }

  await db
    .insert(githubAccount)
    .values({
      userId,
      githubUserId: String(profile.id),
      login: profile.login,
      avatarUrl: profile.avatar_url,
      accessToken: await encrypt(tokens.accessToken, 'github-access-token'),
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshToken: tokens.refreshToken
        ? await encrypt(tokens.refreshToken, 'github-refresh-token')
        : null,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    })
    .onConflictDoUpdate({
      target: githubAccount.userId,
      set: {
        githubUserId: String(profile.id),
        login: profile.login,
        avatarUrl: profile.avatar_url,
        accessToken: await encrypt(tokens.accessToken, 'github-access-token'),
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        refreshToken: tokens.refreshToken
          ? await encrypt(tokens.refreshToken, 'github-refresh-token')
          : null,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
        updatedAt: new Date(),
      },
    })
}

async function refreshAccessToken(userId: string, encryptedRefreshToken: string) {
  const config = getConfig()
  let payload: GitHubTokenResponse
  try {
    payload = await tokenRequest(
      new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: await decrypt(encryptedRefreshToken, 'github-refresh-token'),
      }),
    )
  } catch (error) {
    // Another server instance may have rotated this single-use refresh token.
    // If its database update has landed, use that access token instead of
    // forcing the user to reconnect.
    for (let attempt = 0; attempt < 3; attempt++) {
      const [current] = await db
        .select({
          accessToken: githubAccount.accessToken,
          refreshToken: githubAccount.refreshToken,
        })
        .from(githubAccount)
        .where(eq(githubAccount.userId, userId))
        .limit(1)
      if (current && current.refreshToken !== encryptedRefreshToken) {
        return decrypt(current.accessToken, 'github-access-token')
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw error
  }
  const tokens = tokenDates(payload)
  const tokenUpdate = {
    accessToken: await encrypt(tokens.accessToken, 'github-access-token'),
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    updatedAt: new Date(),
    ...(tokens.refreshToken
      ? {
          refreshToken: await encrypt(tokens.refreshToken, 'github-refresh-token'),
          refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
        }
      : {}),
  }
  const updated = await db
    .update(githubAccount)
    .set(tokenUpdate)
    .where(
      and(
        eq(githubAccount.userId, userId),
        eq(githubAccount.refreshToken, encryptedRefreshToken),
      ),
    )
    .returning({ userId: githubAccount.userId })
  if (updated.length === 0) {
    const [current] = await db
      .select({ accessToken: githubAccount.accessToken })
      .from(githubAccount)
      .where(eq(githubAccount.userId, userId))
      .limit(1)
    if (!current) throw new GitHubIntegrationError('Reconnect GitHub to continue.', 'RECONNECT_REQUIRED')
    return decrypt(current.accessToken, 'github-access-token')
  }
  return tokens.accessToken
}

const pendingTokenRefreshes = new Map<string, Promise<string>>()

function refreshAccessTokenOnce(userId: string, encryptedRefreshToken: string) {
  const existing = pendingTokenRefreshes.get(userId)
  if (existing) return existing
  const refresh = refreshAccessToken(userId, encryptedRefreshToken)
  pendingTokenRefreshes.set(userId, refresh)
  void refresh.finally(() => {
    if (pendingTokenRefreshes.get(userId) === refresh) pendingTokenRefreshes.delete(userId)
  }).catch(() => {})
  return refresh
}

export async function getGitHubAccessToken(userId: string): Promise<string> {
  const [account] = await db
    .select()
    .from(githubAccount)
    .where(eq(githubAccount.userId, userId))
    .limit(1)
  if (!account) throw new GitHubIntegrationError('Connect GitHub to continue.', 'RECONNECT_REQUIRED')
  if (
    !account.accessTokenExpiresAt ||
    account.accessTokenExpiresAt.getTime() > Date.now() + TOKEN_REFRESH_SKEW_MS
  ) {
    return decrypt(account.accessToken, 'github-access-token')
  }
  if (
    !account.refreshToken ||
    (account.refreshTokenExpiresAt && account.refreshTokenExpiresAt.getTime() <= Date.now())
  ) {
    throw new GitHubIntegrationError('Reconnect GitHub to continue.', 'RECONNECT_REQUIRED')
  }
  return refreshAccessTokenOnce(userId, account.refreshToken)
}

export async function syncGitHubInstallations(userId: string) {
  const token = await getGitHubAccessToken(userId)
  const remote = await listInstallations(token)
  const remoteIds = new Set(remote.map((installation) => String(installation.id)))
  const local = await db
    .select({ installationId: githubInstallation.installationId })
    .from(githubInstallation)
    .where(eq(githubInstallation.userId, userId))

  for (const installation of remote) {
    await db
      .insert(githubInstallation)
      .values({
        userId,
        installationId: String(installation.id),
        targetId: String(installation.target_id),
        accountLogin: installation.account.login,
        accountType: installation.target_type,
        avatarUrl: installation.account.avatar_url ?? null,
        repositorySelection: installation.repository_selection,
        suspendedAt: installation.suspended_at ? new Date(installation.suspended_at) : null,
      })
      .onConflictDoUpdate({
        target: [githubInstallation.userId, githubInstallation.installationId],
        set: {
          targetId: String(installation.target_id),
          accountLogin: installation.account.login,
          accountType: installation.target_type,
          avatarUrl: installation.account.avatar_url ?? null,
          repositorySelection: installation.repository_selection,
          suspendedAt: installation.suspended_at ? new Date(installation.suspended_at) : null,
          updatedAt: new Date(),
        },
      })
  }

  for (const installation of local) {
    if (!remoteIds.has(installation.installationId)) {
      await db
        .delete(githubInstallation)
        .where(
          and(
            eq(githubInstallation.userId, userId),
            eq(githubInstallation.installationId, installation.installationId),
          ),
        )
    }
  }
  return remote
}

export interface GitHubRepository {
  installationId: string
  id: string
  owner: string
  name: string
  fullName: string
  private: boolean
  archived: boolean
  defaultBranch: string
  updatedAt: number | null
}

export async function listGitHubRepositories(userId: string): Promise<GitHubRepository[]> {
  if (!githubEnabled) return []
  await syncGitHubInstallations(userId)
  const token = await getGitHubAccessToken(userId)
  const installations = await db
    .select({ installationId: githubInstallation.installationId })
    .from(githubInstallation)
    .where(and(eq(githubInstallation.userId, userId), isNull(githubInstallation.suspendedAt)))

  const repositories = await Promise.all(
    installations.map(async ({ installationId }) => {
      const rows = await listInstallationRepositories(token, installationId)
      return rows.map((repository) => ({
        installationId,
        id: String(repository.id),
        owner: repository.owner.login,
        name: repository.name,
        fullName: repository.full_name,
        private: repository.private,
        archived: repository.archived,
        defaultBranch: repository.default_branch,
        updatedAt: repository.updated_at ? new Date(repository.updated_at).getTime() : null,
      }))
    }),
  )
  const accessible = repositories.flat().sort((a, b) => a.fullName.localeCompare(b.fullName))
  const accessibleIds = new Set(
    accessible.map((repository) => `${repository.installationId}:${repository.id}`),
  )
  const bindings = await db
    .select({
      designId: designGithubRepository.designId,
      installationId: designGithubRepository.installationId,
      repositoryId: designGithubRepository.repositoryId,
    })
    .from(designGithubRepository)
    .where(eq(designGithubRepository.userId, userId))
  for (const binding of bindings) {
    if (!accessibleIds.has(`${binding.installationId}:${binding.repositoryId}`)) {
      await db
        .delete(designGithubRepository)
        .where(
          and(
            eq(designGithubRepository.userId, userId),
            eq(designGithubRepository.designId, binding.designId),
          ),
        )
    }
  }
  return accessible
}

export async function getGitHubStatus(userId: string) {
  const [account] = await db
    .select({
      githubUserId: githubAccount.githubUserId,
      login: githubAccount.login,
      avatarUrl: githubAccount.avatarUrl,
    })
    .from(githubAccount)
    .where(eq(githubAccount.userId, userId))
    .limit(1)
  if (!account) return { enabled: githubEnabled, connected: false as const, account: null, installations: [] }
  const installations = await db
    .select({
      id: githubInstallation.installationId,
      login: githubInstallation.accountLogin,
      type: githubInstallation.accountType,
      avatarUrl: githubInstallation.avatarUrl,
      repositorySelection: githubInstallation.repositorySelection,
      suspendedAt: githubInstallation.suspendedAt,
    })
    .from(githubInstallation)
    .where(eq(githubInstallation.userId, userId))
  return { enabled: githubEnabled, connected: true as const, account, installations }
}

export async function disconnectGitHub(userId: string) {
  const [account] = await db
    .select({ accessToken: githubAccount.accessToken })
    .from(githubAccount)
    .where(eq(githubAccount.userId, userId))
    .limit(1)
  if (account) {
    try {
      const config = getConfig()
      await fetch(`https://api.github.com/applications/${encodeURIComponent(config.clientId)}/token`, {
        method: 'DELETE',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
        },
        body: JSON.stringify({ access_token: await decrypt(account.accessToken, 'github-access-token') }),
      })
    } catch {
      // Local deletion still removes Loora's ability to use the credential.
    }
  }
  await db.delete(githubAccount).where(eq(githubAccount.userId, userId))
  return { disconnected: Boolean(account) }
}

export interface GitHubRepositoryContext extends GitHubRepository {
  accessToken: string
  commitSha: string
  treeSha: string
}

export function selectGitHubRepository(
  repositories: GitHubRepository[],
  requestedRepository: string,
): GitHubRepository {
  const requested = requestedRepository.trim().replace(/^github\.com\//i, '').replace(/\/$/, '')
  if (!requested || requested.split('/').some((part) => !part)) {
    throw new GitHubIntegrationError('Use a repository name like owner/repository.', 'INVALID_PATH')
  }

  const exact = repositories.find(
    (repository) => repository.fullName.toLowerCase() === requested.toLowerCase(),
  )
  if (exact) return exact

  if (!requested.includes('/')) {
    const matches = repositories.filter(
      (repository) => repository.name.toLowerCase() === requested.toLowerCase(),
    )
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) {
      throw new GitHubIntegrationError(
        `More than one accessible repository is named ${requested}. Use owner/repository.`,
        'INVALID_PATH',
      )
    }
  }

  throw new GitHubIntegrationError(
    `Repository ${requested} is not accessible. List repositories to see the available names.`,
    'ACCESS_DENIED',
  )
}

async function hydrateGitHubRepositoryContext(
  userId: string,
  repository: GitHubRepository,
): Promise<GitHubRepositoryContext> {
  const accessToken = await getGitHubAccessToken(userId)
  const commit = await githubRequest<{
    sha: string
    commit: { tree: { sha: string } }
  }>(
    `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/commits/${encodeURIComponent(repository.defaultBranch)}`,
    accessToken,
  )
  return { ...repository, accessToken, commitSha: commit.sha, treeSha: commit.commit.tree.sha }
}

export async function getGitHubRepositoryContextByName(
  userId: string,
  requestedRepository: string,
): Promise<GitHubRepositoryContext> {
  const repositories = await listGitHubRepositories(userId)
  return hydrateGitHubRepositoryContext(
    userId,
    selectGitHubRepository(repositories, requestedRepository),
  )
}

export async function getGitHubRepositoryContext(
  userId: string,
  designId: string,
): Promise<GitHubRepositoryContext | null> {
  const [binding] = await db
    .select()
    .from(designGithubRepository)
    .where(
      and(
        eq(designGithubRepository.userId, userId),
        eq(designGithubRepository.designId, designId),
      ),
    )
    .limit(1)
  if (!binding) {
    return null
  }

  const repositories = await listGitHubRepositories(userId)
  const repository = repositories.find(
    (candidate) =>
      candidate.installationId === binding.installationId && candidate.id === binding.repositoryId,
  )
  if (!repository) {
    await db
      .delete(designGithubRepository)
      .where(
        and(
          eq(designGithubRepository.userId, userId),
          eq(designGithubRepository.designId, designId),
        ),
      )
    throw new GitHubIntegrationError('The selected repository is no longer accessible.', 'ACCESS_DENIED')
  }

  if (
    repository.owner !== binding.owner ||
    repository.name !== binding.name ||
    repository.defaultBranch !== binding.defaultBranch
  ) {
    await db
      .update(designGithubRepository)
      .set({
        owner: repository.owner,
        name: repository.name,
        defaultBranch: repository.defaultBranch,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(designGithubRepository.userId, userId),
          eq(designGithubRepository.designId, designId),
        ),
      )
  }

  return hydrateGitHubRepositoryContext(userId, repository)
}

const hiddenSegments = new Set([
  'node_modules',
  'vendor',
  'dist',
  'build',
  'coverage',
  'target',
  '.next',
  '.output',
  '.turbo',
])

const sensitiveBasenames = new Set([
  '.env',
  '.npmrc',
  '.netrc',
  '.pypirc',
  'credentials',
  'credentials.json',
  'id_rsa',
  'id_ed25519',
])

export function normalizeRepositoryPath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '')
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.includes('\0') ||
    normalized.split('/').some((segment) => segment === '..' || segment === '.' || segment === '')
  ) {
    throw new GitHubIntegrationError('Invalid repository path.', 'INVALID_PATH')
  }
  return normalized
}

export function isSensitiveRepositoryPath(path: string): boolean {
  const basename = path.split('/').at(-1)?.toLowerCase() ?? ''
  if (basename.startsWith('.env.') && basename !== '.env.example') return true
  return (
    sensitiveBasenames.has(basename) ||
    /\.(?:pem|key|p12|pfx|jks|keystore)$/i.test(basename) ||
    /(?:^|[-_.])(?:secret|secrets|credentials)(?:[-_.]|$)/i.test(basename)
  )
}

function assertReadablePath(path: string): string {
  const normalized = normalizeRepositoryPath(path)
  if (isSensitiveRepositoryPath(normalized)) {
    throw new GitHubIntegrationError('Sensitive credential files cannot be read.', 'SENSITIVE_PATH')
  }
  return normalized
}

const secretPatterns: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bgh[opsu]_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /(^|\n)(\s*[A-Za-z0-9_.-]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY)[A-Za-z0-9_.-]*\s*[:=]\s*)([^\n]+)/gi,
]

export function redactRepositorySecrets(value: string): { text: string; redacted: boolean } {
  let text = value
  for (const pattern of secretPatterns) {
    text = text.replace(pattern, (...args: string[]) => {
      if (pattern === secretPatterns.at(-1)) return `${args[1]}${args[2]}[REDACTED]`
      return '[REDACTED]'
    })
  }
  return { text, redacted: text !== value }
}

function repoPath(context: GitHubRepositoryContext, suffix: string): string {
  return `/repos/${encodeURIComponent(context.owner)}/${encodeURIComponent(context.name)}${suffix}`
}

export async function listRepositoryTree(
  context: GitHubRepositoryContext,
  input: { pathPrefix?: string; depth?: number; includeGenerated?: boolean },
) {
  const requestedPrefix = input.pathPrefix?.replace(/[\\/]+$/, '')
  const prefix = requestedPrefix ? normalizeRepositoryPath(requestedPrefix) : ''
  const depth = Math.min(6, Math.max(1, input.depth ?? 4))
  const payload = await githubRequest<{
    tree: { path: string; type: string; size?: number }[]
    truncated?: boolean
  }>(`${repoPath(context, `/git/trees/${encodeURIComponent(context.treeSha)}`)}?recursive=1`, context.accessToken)

  const paths = payload.tree
    .filter((entry) => {
      if (prefix && entry.path !== prefix && !entry.path.startsWith(`${prefix}/`)) return false
      const relative = prefix ? entry.path.slice(prefix.length).replace(/^\//, '') : entry.path
      if (relative.split('/').length > depth) return false
      if (!input.includeGenerated) {
        const segments = entry.path.split('/')
        if (segments.some((segment) => hiddenSegments.has(segment))) return false
        if (/\.(?:min\.js|map|lock)$/i.test(entry.path) || /routeTree\.gen\./.test(entry.path)) return false
      }
      if (isSensitiveRepositoryPath(entry.path)) return false
      return true
    })
    .slice(0, 2_500)
    .map((entry) => ({ path: entry.path, type: entry.type, size: entry.size }))
  return {
    repository: context.fullName,
    commitSha: context.commitSha,
    paths,
    truncated: Boolean(payload.truncated || paths.length === 2_500),
  }
}

export async function searchRepositoryCode(
  context: GitHubRepositoryContext,
  input: { query: string; pathPrefix?: string; extension?: string; limit?: number },
) {
  if (/(?:^|\s)(?:repo|org|user):/i.test(input.query)) {
    throw new GitHubIntegrationError('Repository-changing search qualifiers are not allowed.', 'INVALID_PATH')
  }
  const qualifiers = [`repo:${context.fullName}`]
  const requestedPrefix = input.pathPrefix?.replace(/[\\/]+$/, '')
  if (requestedPrefix) qualifiers.push(`path:${normalizeRepositoryPath(requestedPrefix)}`)
  if (input.extension) {
    const extension = input.extension.replace(/^\./, '')
    if (!/^[a-z0-9_+-]{1,16}$/i.test(extension)) {
      throw new GitHubIntegrationError('Invalid file extension.', 'INVALID_PATH')
    }
    qualifiers.push(`extension:${extension}`)
  }
  const limit = Math.min(20, Math.max(1, input.limit ?? 10))
  const params = new URLSearchParams({ q: `${input.query} ${qualifiers.join(' ')}`, per_page: String(limit) })
  const payload = await githubRequest<{
    total_count: number
    items: {
      path: string
      sha: string
      text_matches?: { fragment?: string }[]
    }[]
  }>(`/search/code?${params}`, context.accessToken, {
    headers: { Accept: 'application/vnd.github.text-match+json' },
  })
  let redacted = false
  const matches = payload.items
    .filter((item) => !isSensitiveRepositoryPath(item.path))
    .slice(0, limit)
    .map((item) => {
      const cleaned = redactRepositorySecrets(item.text_matches?.[0]?.fragment ?? '')
      redacted ||= cleaned.redacted
      return { path: item.path, sha: item.sha, fragment: cleaned.text.slice(0, 600) }
    })
  return {
    repository: context.fullName,
    commitSha: context.commitSha,
    total: payload.total_count,
    matches,
    redacted,
  }
}

async function rawRepositoryFile(context: GitHubRepositoryContext, path: string, maxBytes: number) {
  const tree = await githubRequest<{
    tree: { path: string; mode: string; type: string; sha: string; size?: number }[]
    truncated?: boolean
  }>(
    `${repoPath(context, `/git/trees/${encodeURIComponent(context.treeSha)}`)}?recursive=1`,
    context.accessToken,
  )
  const entry = tree.tree.find((candidate) => candidate.path === path)
  if (!entry) {
    throw new GitHubIntegrationError(
      tree.truncated
        ? 'This repository tree is too large to resolve that file safely.'
        : 'The repository file was not found.',
      tree.truncated ? 'GITHUB_ERROR' : 'ACCESS_DENIED',
    )
  }
  if (entry.type !== 'blob' || entry.mode === '120000') {
    throw new GitHubIntegrationError('Symlinks and non-file entries cannot be read.', 'UNSUPPORTED_FILE')
  }
  if ((entry.size ?? 0) > maxBytes) {
    throw new GitHubIntegrationError('Repository file is too large.', 'TOO_LARGE')
  }
  const blob = await githubRequest<{ content: string; encoding: string; size: number }>(
    repoPath(context, `/git/blobs/${encodeURIComponent(entry.sha)}`),
    context.accessToken,
  )
  if (blob.encoding !== 'base64') {
    throw new GitHubIntegrationError('GitHub returned an unsupported file encoding.', 'UNSUPPORTED_FILE')
  }
  if (blob.size > maxBytes) throw new GitHubIntegrationError('Repository file is too large.', 'TOO_LARGE')
  const decoded = Buffer.from(blob.content.replace(/\s/g, ''), 'base64')
  if (decoded.length > maxBytes) throw new GitHubIntegrationError('Repository file is too large.', 'TOO_LARGE')
  const bytes = new Uint8Array(decoded.length)
  bytes.set(decoded)
  return bytes
}

export async function readRepositoryFile(
  context: GitHubRepositoryContext,
  input: { path: string; startLine?: number; endLine?: number },
) {
  const path = assertReadablePath(input.path)
  const bytes = await rawRepositoryFile(context, path, MAX_TEXT_FILE_BYTES)
  let source: string
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new GitHubIntegrationError('Only UTF-8 text files can be read.', 'UNSUPPORTED_FILE')
  }
  if (source.includes('\0')) throw new GitHubIntegrationError('Binary files cannot be read as text.', 'UNSUPPORTED_FILE')
  const lines = source.split('\n')
  const startLine = Math.max(1, input.startLine ?? 1)
  const requestedEnd = input.endLine ?? startLine + 399
  const endLine = Math.min(lines.length, requestedEnd, startLine + 399)
  const selection = lines.slice(startLine - 1, endLine).join('\n').slice(0, 64 * 1024)
  const cleaned = redactRepositorySecrets(selection)
  return {
    repository: context.fullName,
    commitSha: context.commitSha,
    path,
    startLine,
    endLine,
    totalLines: lines.length,
    content: cleaned.text,
    redacted: cleaned.redacted,
    truncated: endLine < lines.length || selection.length === 64 * 1024,
  }
}

const imageTypes: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

export function isRepositoryImage(bytes: Uint8Array, mediaType: string): boolean {
  if (mediaType === 'image/png') {
    return bytes.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
  }
  if (mediaType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }
  if (mediaType === 'image/gif') {
    const signature = new TextDecoder().decode(bytes.slice(0, 6))
    return signature === 'GIF87a' || signature === 'GIF89a'
  }
  if (mediaType === 'image/webp') {
    return bytes.length >= 12 &&
      new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
      new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
  }
  return false
}

export async function viewRepositoryImage(
  context: GitHubRepositoryContext,
  input: { path: string },
) {
  const path = assertReadablePath(input.path)
  const extension = path.split('.').at(-1)?.toLowerCase() ?? ''
  const mediaType = imageTypes[extension]
  if (!mediaType) throw new GitHubIntegrationError('Unsupported repository image type.', 'UNSUPPORTED_FILE')
  const bytes = await rawRepositoryFile(context, path, MAX_IMAGE_BYTES)
  if (!isRepositoryImage(bytes, mediaType)) {
    throw new GitHubIntegrationError('The requested file is not an image.', 'UNSUPPORTED_FILE')
  }
  return {
    repository: context.fullName,
    commitSha: context.commitSha,
    path,
    mediaType,
    data: Buffer.from(bytes).toString('base64'),
  }
}

export async function verifyGitHubWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret: string,
) {
  if (!signature || !/^sha256=[0-9a-f]{64}$/i.test(signature)) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = Buffer.from(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)),
  )
  const provided = Buffer.from(signature.slice(7), 'hex')
  return provided.length === digest.length && timingSafeEqual(provided, digest)
}

export function verifyGitHubWebhook(rawBody: string, signature: string | null) {
  return verifyGitHubWebhookSignature(rawBody, signature, getConfig().webhookSecret)
}

interface InstallationEventPayload {
  action?: string
  installation?: GitHubInstallationPayload
  sender?: GitHubUserPayload
  repositories_removed?: { id: number }[]
}

export async function processGitHubWebhook(event: string, payload: InstallationEventPayload) {
  if (event === 'github_app_authorization' && payload.action === 'revoked' && payload.sender) {
    await db
      .delete(githubAccount)
      .where(eq(githubAccount.githubUserId, String(payload.sender.id)))
    return
  }
  const installationId = payload.installation ? String(payload.installation.id) : null
  if (!installationId) return

  if (event === 'installation') {
    if (payload.action === 'deleted') {
      await db
        .delete(githubInstallation)
        .where(eq(githubInstallation.installationId, installationId))
      return
    }
    if (payload.action === 'suspend' || payload.action === 'unsuspend') {
      await db
        .update(githubInstallation)
        .set({
          suspendedAt: payload.action === 'suspend' ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(githubInstallation.installationId, installationId))
      return
    }
  }

  if (event === 'installation_repositories' && payload.repositories_removed?.length) {
    await db
      .delete(designGithubRepository)
      .where(
        and(
          eq(designGithubRepository.installationId, installationId),
          inArray(
            designGithubRepository.repositoryId,
            payload.repositories_removed.map((repository) => String(repository.id)),
          ),
        ),
      )
  }
}
