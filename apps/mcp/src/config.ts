export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export type Config = {
  port: number
  publicUrl: string
  authOrigin: string
  authorizationServerUrl: string
  authTimeoutMs: number
  authCacheTtlMs: number
  internalApiUrl: string
  internalToken: string
  redisUrl: string | null
}

export type EnvValues = Record<string, string | undefined>

export function configFrom(get: (key: string) => string | undefined): Config {
  const port = parsePort(get('PORT') ?? '4100')
  const publicUrl = cleanUrl(
    'MCP_PUBLIC_URL',
    get('MCP_PUBLIC_URL') ?? `http://localhost:${port}`,
  )
  const authOrigin = cleanOrigin(
    'BETTER_AUTH_URL',
    get('BETTER_AUTH_URL') ?? 'http://localhost:3000',
  )
  const authorizationServerUrl = cleanOrigin(
    'MCP_AUTHORIZATION_SERVER_URL',
    get('MCP_AUTHORIZATION_SERVER_URL') ?? authOrigin,
  )
  const internalApiUrl = cleanUrl(
    'MCP_INTERNAL_API_URL',
    get('MCP_INTERNAL_API_URL') ?? `${authOrigin}/api/internal/mcp`,
  )
  const internalToken = optional(get('MCP_INTERNAL_TOKEN'))
  if (!internalToken) {
    throw new ConfigError('MCP_INTERNAL_TOKEN must be set')
  }
  return {
    port,
    publicUrl,
    authOrigin,
    authorizationServerUrl,
    authTimeoutMs: bounded(get('MCP_AUTH_TIMEOUT_MS'), 100, 30_000, 5_000),
    authCacheTtlMs: bounded(get('MCP_AUTH_CACHE_TTL_MS'), 0, 600_000, 60_000),
    internalApiUrl,
    internalToken,
    redisUrl: optional(get('REDIS_URL')),
  }
}

function parsePort(value: string) {
  const port = Number(value.trim())
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError('PORT must be a valid TCP port')
  }
  return port
}

function optional(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function bounded(
  value: string | undefined,
  min: number,
  max: number,
  fallback: number,
) {
  const parsed = Number(value?.trim())
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback
  return parsed
}

function cleanUrl(name: string, value: string) {
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new ConfigError(`${name} must be an absolute HTTP URL`)
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    !parsed.hostname
  ) {
    throw new ConfigError(`${name} must be an absolute HTTP URL`)
  }
  return value.trim().replace(/\/+$/, '')
}

function cleanOrigin(name: string, value: string) {
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new ConfigError(`${name} must be an absolute HTTP URL`)
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    !parsed.hostname
  ) {
    throw new ConfigError(`${name} must be an absolute HTTP URL`)
  }
  return parsed.origin
}
