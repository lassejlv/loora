import { describe, expect, test } from 'vitest'
import { configFrom } from './config'
import type { FetchImpl } from './env'
import { createAppState, handleRequest } from './handler'

function configWith(values: Record<string, string>) {
  return configFrom((key) => values[key])
}

function backendFetch(
  handler: (request: Request) => Response | Promise<Response>,
): FetchImpl {
  return async (input, init) => handler(new Request(input, init))
}

async function mcpCall(
  state: ReturnType<typeof createAppState>,
  body: unknown,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers)
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  if (!headers.has('accept')) {
    headers.set('accept', 'application/json, text/event-stream')
  }
  if (!headers.has('host')) headers.set('host', 'localhost:4100')
  return handleRequest(
    new Request('http://localhost:4100/mcp', {
      method: 'POST',
      ...init,
      headers,
      body: JSON.stringify(body),
    }),
    state,
  )
}

describe('MCP worker HTTP contract', () => {
  test('authenticated tool calls are forwarded to the internal executor', async () => {
    const state = createAppState(
      configWith({
        MCP_INTERNAL_TOKEN: 'shared-secret',
        BETTER_AUTH_URL: 'https://auth.test',
        MCP_AUTHORIZATION_SERVER_URL: 'https://loora.test',
        MCP_INTERNAL_API_URL: 'https://auth.test/api/internal/mcp',
        MCP_PUBLIC_URL: 'http://localhost:4100',
      }),
      {
        fetchImpl: backendFetch(async (request) => {
          const url = new URL(request.url)
          if (url.pathname === '/api/auth/mcp/get-session') {
            return Response.json({
              userId: 'user-test',
              accessTokenExpiresAt: '2099-01-01T00:00:00Z',
            })
          }
          if (url.pathname === '/api/internal/mcp') {
            expect(request.headers.get('authorization')).toBe(
              'Bearer shared-secret',
            )
            const body = (await request.json()) as {
              action?: string
              userId?: string
              tool?: string
            }
            if (body.action === 'access') return Response.json({ allowed: true })
            if (body.action === 'execute') {
              expect(body.userId).toBe('user-test')
              expect(body.tool).toBe('getUsage')
              return Response.json({
                content: [{ type: 'text', text: 'forwarded' }],
              })
            }
            throw new Error(`unexpected internal action: ${body.action}`)
          }
          return new Response('not found', { status: 404 })
        }),
      },
    )
    const response = await mcpCall(
      state,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'getUsage', arguments: {} },
      },
      {
        headers: {
          authorization: 'Bearer oauth-token',
          'mcp-protocol-version': '2025-06-18',
        },
      },
    )
    const body = await response.json()
    expect(response.status, JSON.stringify(body)).toBe(200)
    expect(body.result.content[0].text).toBe('forwarded')
  })

  test('auth service failures are retryable without a login challenge', async () => {
    const state = createAppState(
      configWith({
        MCP_INTERNAL_TOKEN: 'shared-secret',
        BETTER_AUTH_URL: 'https://auth.test',
        MCP_AUTHORIZATION_SERVER_URL: 'https://loora.test',
        MCP_INTERNAL_API_URL: 'https://auth.test/api/internal/mcp',
        MCP_PUBLIC_URL: 'http://localhost:4100',
      }),
      {
        fetchImpl: backendFetch(() => new Response(null, { status: 503 })),
      },
    )
    const response = await mcpCall(
      state,
      { jsonrpc: '2.0', id: 1, method: 'initialize' },
      { headers: { authorization: 'Bearer oauth-token' } },
    )
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('1')
    expect(response.headers.get('www-authenticate')).toBeNull()
    const body = await response.json()
    expect(body.error.message).toBe(
      'Authentication service is temporarily unavailable. Try again shortly.',
    )
  })

  test('invalid auth sessions restart the OAuth flow', async () => {
    const state = createAppState(
      configWith({
        MCP_INTERNAL_TOKEN: 'shared-secret',
        BETTER_AUTH_URL: 'https://auth.test',
        MCP_AUTHORIZATION_SERVER_URL: 'https://loora.test',
        MCP_INTERNAL_API_URL: 'https://auth.test/api/internal/mcp',
        MCP_PUBLIC_URL: 'http://localhost:4100',
      }),
      {
        fetchImpl: backendFetch(() => Response.json(null)),
      },
    )
    const response = await mcpCall(
      state,
      { jsonrpc: '2.0', id: 1, method: 'initialize' },
      { headers: { authorization: 'Bearer expired-oauth-token' } },
    )

    expect(response.status).toBe(401)
    expect(response.headers.get('retry-after')).toBeNull()
    expect(response.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="http://localhost:4100/.well-known/oauth-protected-resource"',
    )
    const body = await response.json()
    expect(body.error.message).toBe('Unauthorized: Authentication required')
  })

  test('advertises the pinned authorization server', async () => {
    const state = createAppState(
      configWith({
        MCP_INTERNAL_TOKEN: 'shared-secret',
        BETTER_AUTH_URL: 'http://internal.loora.test',
        MCP_AUTHORIZATION_SERVER_URL: 'https://loora.test',
        MCP_INTERNAL_API_URL: 'http://internal.loora.test/api/internal/mcp',
        MCP_PUBLIC_URL: 'http://localhost:4100',
      }),
    )
    const response = await handleRequest(
      new Request('http://localhost:4100/.well-known/oauth-protected-resource', {
        headers: { host: 'localhost:4100' },
      }),
      state,
    )
    const body = await response.json()
    expect(body.authorization_servers).toEqual(['https://loora.test'])
  })

  test('unauthorized MCP calls include a resource metadata challenge', async () => {
    const state = createAppState(
      configWith({
        MCP_INTERNAL_TOKEN: 'shared-secret',
        MCP_PUBLIC_URL: 'http://localhost:4100',
      }),
    )
    const response = await mcpCall(state, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
    })
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="http://localhost:4100/.well-known/oauth-protected-resource"',
    )
  })
})
