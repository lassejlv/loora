import { describe, expect, it } from 'bun:test'
import { createMcpSessionVerifier } from './auth'

describe('createMcpSessionVerifier', () => {
  it('does not call the auth server without a bearer token', async () => {
    let requests = 0
    const verifier = createMcpSessionVerifier(
      'https://loora.test',
      async () => {
        requests += 1
        return new Response(null, { status: 500 })
      },
    )

    expect(await verifier.getSession(new Headers())).toBeNull()
    expect(requests).toBe(0)
  })

  it('verifies tokens through the remote Better Auth server', async () => {
    const requests: Array<{ url: string; authorization: string | null }> = []
    const verifier = createMcpSessionVerifier(
      'https://loora.test/',
      async (input, init) => {
        const headers = new Headers(init?.headers)
        requests.push({
          url: String(input),
          authorization: headers.get('authorization'),
        })
        return Response.json({
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
          refreshTokenExpiresAt: '2099-02-01T00:00:00.000Z',
          clientId: 'client-id',
          userId: 'user-id',
          scopes: 'openid profile',
        })
      },
    )

    const session = await verifier.getSession(new Headers({
      authorization: 'Bearer test-token',
    }))

    expect(session?.userId).toBe('user-id')
    expect(requests).toEqual([{
      url: 'https://loora.test/api/auth/mcp/get-session',
      authorization: 'Bearer test-token',
    }])
  })

  it('treats an unavailable auth server as unauthenticated', async () => {
    const verifier = createMcpSessionVerifier(
      'https://loora.test',
      async () => {
        throw new Error('offline')
      },
    )

    expect(await verifier.getSession(new Headers({
      authorization: 'Bearer test-token',
    }))).toBeNull()
  })

  it('stops waiting when the auth server exceeds its timeout', async () => {
    let aborted = false
    const verifier = createMcpSessionVerifier(
      'https://loora.test',
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            aborted = true
            reject(init.signal?.reason)
          }, { once: true })
        }),
      10,
    )

    expect(await verifier.getSession(new Headers({
      authorization: 'Bearer test-token',
    }))).toBeNull()
    expect(aborted).toBe(true)
  })

  it('caches verified sessions per token instead of re-verifying every call', async () => {
    let requests = 0
    const verifier = createMcpSessionVerifier(
      'https://loora.test',
      async () => {
        requests += 1
        return Response.json({
          accessToken: 'access-token',
          accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
          clientId: 'client-id',
          userId: 'user-id',
          scopes: 'openid profile',
        })
      },
      5_000,
      60_000,
    )

    const headers = new Headers({ authorization: 'Bearer test-token' })
    expect((await verifier.getSession(headers))?.userId).toBe('user-id')
    expect((await verifier.getSession(headers))?.userId).toBe('user-id')
    expect(requests).toBe(1)

    // A different token is its own cache entry.
    expect(
      (
        await verifier.getSession(
          new Headers({ authorization: 'Bearer other-token' }),
        )
      )?.userId,
    ).toBe('user-id')
    expect(requests).toBe(2)
  })

  it('never caches failed verification', async () => {
    let requests = 0
    const verifier = createMcpSessionVerifier(
      'https://loora.test',
      async () => {
        requests += 1
        return new Response(null, { status: 401 })
      },
      5_000,
      60_000,
    )

    const headers = new Headers({ authorization: 'Bearer bad-token' })
    expect(await verifier.getSession(headers)).toBeNull()
    expect(await verifier.getSession(headers)).toBeNull()
    expect(requests).toBe(2)
  })

  it('does not serve a cached session past the token expiry', async () => {
    let requests = 0
    const soon = new Date(Date.now() + 20).toISOString()
    const verifier = createMcpSessionVerifier(
      'https://loora.test',
      async () => {
        requests += 1
        return Response.json({
          accessToken: 'access-token',
          accessTokenExpiresAt: soon,
          clientId: 'client-id',
          userId: 'user-id',
          scopes: 'openid profile',
        })
      },
      5_000,
      60_000,
    )

    const headers = new Headers({ authorization: 'Bearer test-token' })
    expect((await verifier.getSession(headers))?.userId).toBe('user-id')
    await new Promise((resolve) => setTimeout(resolve, 30))
    // Token now expired: the cache entry lapsed with it, and Better Auth's
    // own expiry check rejects the re-verified session.
    expect(await verifier.getSession(headers)).toBeNull()
    expect(requests).toBe(2)
  })

  it('bypasses the cache when the TTL is zero', async () => {
    let requests = 0
    const verifier = createMcpSessionVerifier(
      'https://loora.test',
      async () => {
        requests += 1
        return Response.json({
          accessToken: 'access-token',
          accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
          clientId: 'client-id',
          userId: 'user-id',
          scopes: 'openid profile',
        })
      },
      5_000,
      0,
    )

    const headers = new Headers({ authorization: 'Bearer test-token' })
    await verifier.getSession(headers)
    await verifier.getSession(headers)
    expect(requests).toBe(2)
  })
})
