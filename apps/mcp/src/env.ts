export type RateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

export type FetchImpl = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

/**
 * Cloudflare Worker bindings. Secrets (`MCP_INTERNAL_TOKEN`, optional
 * `MCP_INTERNAL_API_URL` / `REDIS_URL`) are set with `wrangler secret`, not
 * committed in wrangler.jsonc.
 */
export type Env = {
  MCP_PUBLIC_URL: string
  BETTER_AUTH_URL: string
  MCP_AUTHORIZATION_SERVER_URL?: string
  MCP_INTERNAL_API_URL?: string
  MCP_INTERNAL_TOKEN: string
  MCP_AUTH_TIMEOUT_MS?: string
  MCP_AUTH_CACHE_TTL_MS?: string
  REDIS_URL?: string
  MCP_ADDRESS?: RateLimitBinding
  MCP_ANONYMOUS?: RateLimitBinding
  MCP_ACCOUNT?: RateLimitBinding
}

export function envValue(
  env: Env | NodeJS.ProcessEnv,
  key: string,
): string | undefined {
  const value = (env as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}
