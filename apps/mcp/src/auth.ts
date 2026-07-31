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

function authTimeout() {
  const value = Number(process.env.MCP_AUTH_TIMEOUT_MS ?? 5_000)
  return Number.isInteger(value) && value >= 100 && value <= 30_000
    ? value
    : 5_000
}

export function createMcpSessionVerifier(
  authOrigin: string,
  fetchImpl: McpAuthFetch = globalThis.fetch,
  timeoutMs = authTimeout(),
): McpSessionVerifier {
  const authURL = new URL('/api/auth', `${authOrigin.replace(/\/+$/, '')}/`).toString()
    .replace(/\/+$/, '')
  const timedFetch: McpAuthFetch = async (input, init) => {
    const controller = new AbortController()
    const callerSignal =
      init?.signal ??
      (input instanceof Request ? input.signal : undefined)
    const abortFromCaller = () => controller.abort(callerSignal?.reason)
    if (callerSignal?.aborted) abortFromCaller()
    else callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    timer.unref?.()
    try {
      return await fetchImpl(input, {
        ...init,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
      callerSignal?.removeEventListener('abort', abortFromCaller)
    }
  }
  const client = createMcpAuthClient({
    authURL,
    fetch: timedFetch as typeof globalThis.fetch,
  })

  return {
    async getSession(headers) {
      const authorization = headers.get('authorization')
      if (!authorization?.startsWith('Bearer ')) return null
      return client.verifyToken(authorization.slice('Bearer '.length))
    },
  }
}
