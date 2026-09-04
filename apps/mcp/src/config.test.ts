import { describe, expect, test } from 'vitest'
import { ConfigError, configFrom } from './config'

function from(values: Record<string, string>) {
  return configFrom((key) => values[key])
}

describe('MCP worker config', () => {
  test('normalizes origins and defaults the internal endpoint', () => {
    const config = from({
      MCP_INTERNAL_TOKEN: 'secret',
      BETTER_AUTH_URL: 'https://loora.test:8443/some/path?ignored=true',
      MCP_AUTHORIZATION_SERVER_URL:
        'https://accounts.loora.test/oauth?ignored=true',
      MCP_AUTH_TIMEOUT_MS: '100',
      MCP_AUTH_CACHE_TTL_MS: '600000',
    })
    expect(config.authOrigin).toBe('https://loora.test:8443')
    expect(config.authorizationServerUrl).toBe('https://accounts.loora.test')
    expect(config.internalApiUrl).toBe(
      'https://loora.test:8443/api/internal/mcp',
    )
    expect(config.authTimeoutMs).toBe(100)
    expect(config.authCacheTtlMs).toBe(600_000)
  })

  test('defaults the authorization server to the auth origin', () => {
    const config = from({
      MCP_INTERNAL_TOKEN: 'secret',
      BETTER_AUTH_URL: 'https://loora.test/auth',
    })
    expect(config.authorizationServerUrl).toBe('https://loora.test')
  })

  test('requires the internal token', () => {
    expect(() => from({})).toThrow(ConfigError)
  })

  test('rate limit uses the shared redis url', () => {
    const config = from({
      MCP_INTERNAL_TOKEN: 'secret',
      REDIS_URL: ' redis://localhost:6379 ',
    })
    expect(config.redisUrl).toBe('redis://localhost:6379')
  })
})
