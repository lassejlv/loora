import { afterEach, describe, expect, test, vi } from 'vitest'
import { AuthVerifier } from './auth'
import type { FetchImpl } from './env'

function bearer(token: string) {
  return new Headers({ authorization: `Bearer ${token}` })
}

function authFetch(handler: (request: Request) => Response | Promise<Response>): FetchImpl {
  return async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.pathname !== '/api/auth/mcp/get-session') {
      return new Response('not found', { status: 404 })
    }
    return handler(request)
  }
}

describe('MCP auth verifier', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('does not rebind the platform fetch receiver', async () => {
    let receiver: unknown = Symbol('not-called')
    vi.stubGlobal('fetch', function (this: unknown) {
      receiver = this
      return Promise.resolve(Response.json({ userId: 'user-id' }))
    })
    const verifier = new AuthVerifier({
      authOrigin: 'https://auth.test',
      timeoutMs: 5_000,
      cacheTtlMs: 0,
    })

    await expect(verifier.verifyToken('token')).resolves.toMatchObject({
      userId: 'user-id',
    })
    expect(receiver).toBeUndefined()
  })

  test('verifies and caches successful sessions', async () => {
    let requests = 0
    const verifier = new AuthVerifier({
      authOrigin: 'https://auth.test',
      timeoutMs: 5_000,
      cacheTtlMs: 60_000,
      fetchImpl: authFetch(() => {
        requests += 1
        return Response.json({
          userId: 'user-id',
          accessTokenExpiresAt: '2099-01-01T00:00:00Z',
        })
      }),
    })
    const first = await verifier.getSession(bearer('token'))
    const second = await verifier.getSession(bearer('token'))
    expect(first.userId).toBe('user-id')
    expect(first.accessTokenExpiresAt).not.toBeNull()
    expect(second).toEqual(first)
    expect(requests).toBe(1)
  })

  test('does not cache invalid tokens or when ttl is zero', async () => {
    let requests = 0
    const verifier = new AuthVerifier({
      authOrigin: 'https://auth.test',
      timeoutMs: 5_000,
      cacheTtlMs: 0,
      fetchImpl: authFetch(() => {
        const request = requests
        requests += 1
        if (request < 2) return new Response('{}', { status: 401 })
        return Response.json({ userId: 'user-id' })
      }),
    })
    const headers = bearer('token')
    await expect(verifier.getSession(headers)).rejects.toMatchObject({
      code: 'invalid-token',
    })
    await expect(verifier.getSession(headers)).rejects.toMatchObject({
      code: 'invalid-token',
    })
    await expect(verifier.getSession(headers)).resolves.toMatchObject({
      userId: 'user-id',
    })
    await expect(verifier.getSession(headers)).resolves.toMatchObject({
      userId: 'user-id',
    })
    expect(requests).toBe(4)
  })

  test('treats Better Auth null sessions as invalid tokens', async () => {
    const verifier = new AuthVerifier({
      authOrigin: 'https://auth.test',
      timeoutMs: 5_000,
      cacheTtlMs: 60_000,
      fetchImpl: authFetch(() => Response.json(null)),
    })

    await expect(verifier.verifyToken('token')).rejects.toMatchObject({
      code: 'invalid-token',
    })
  })

  test('treats invalid upstream responses as service failures', async () => {
    let requests = 0
    const verifier = new AuthVerifier({
      authOrigin: 'https://auth.test',
      timeoutMs: 5_000,
      cacheTtlMs: 60_000,
      fetchImpl: authFetch(() => {
        const request = requests
        requests += 1
        if (request === 0) return new Response(null, { status: 503 })
        if (request === 1) return new Response('not-json', { status: 200 })
        if (request === 2) return Response.json({ userId: '' })
        return Response.json({ userId: 'user-id' })
      }),
    })
    const headers = bearer('token')
    for (let i = 0; i < 3; i += 1) {
      await expect(verifier.getSession(headers)).rejects.toMatchObject({
        code: 'unavailable',
      })
    }
    await expect(verifier.getSession(headers)).resolves.toMatchObject({
      userId: 'user-id',
    })
    expect(requests).toBe(4)
  })

  test('rejects missing credentials as an invalid token', async () => {
    const verifier = new AuthVerifier({
      authOrigin: 'http://localhost:1',
      timeoutMs: 100,
      cacheTtlMs: 0,
    })
    await expect(verifier.getSession(new Headers())).rejects.toMatchObject({
      code: 'invalid-token',
    })
  })

  test('expires cached sessions with the access token', async () => {
    let requests = 0
    const expiresAt = new Date(Date.now() + 50).toISOString()
    const verifier = new AuthVerifier({
      authOrigin: 'https://auth.test',
      timeoutMs: 5_000,
      cacheTtlMs: 60_000,
      fetchImpl: authFetch(() => {
        requests += 1
        return Response.json({
          userId: 'user-id',
          accessTokenExpiresAt: expiresAt,
        })
      }),
    })
    const headers = bearer('token')
    await expect(verifier.getSession(headers)).resolves.toMatchObject({
      userId: 'user-id',
    })
    await new Promise((resolve) => setTimeout(resolve, 80))
    await expect(verifier.getSession(headers)).resolves.toMatchObject({
      userId: 'user-id',
    })
    expect(requests).toBe(2)
  })
})
