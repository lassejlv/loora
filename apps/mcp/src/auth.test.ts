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
})
