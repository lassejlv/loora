import {
  createMcpAuthClient,
  type McpSession,
} from 'better-auth/plugins/mcp/client'

export interface McpSessionVerifier {
  getSession: (headers: Headers) => Promise<McpSession | null>
}

type McpAuthFetch = (
  ...args: Parameters<typeof globalThis.fetch>
) => ReturnType<typeof globalThis.fetch>

export function createMcpSessionVerifier(
  authOrigin: string,
  fetchImpl: McpAuthFetch = globalThis.fetch,
): McpSessionVerifier {
  const authURL = new URL('/api/auth', `${authOrigin.replace(/\/+$/, '')}/`).toString()
    .replace(/\/+$/, '')
  const client = createMcpAuthClient({
    authURL,
    fetch: fetchImpl as typeof globalThis.fetch,
  })

  return {
    async getSession(headers) {
      const authorization = headers.get('authorization')
      if (!authorization?.startsWith('Bearer ')) return null
      return client.verifyToken(authorization.slice('Bearer '.length))
    },
  }
}
