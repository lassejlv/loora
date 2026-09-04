import { authErrorCode, AuthVerifier } from './auth'
import { configFrom, type Config } from './config'
import type { Env, FetchImpl } from './env'
import { envValue } from './env'
import { callInternal, InternalMcpError } from './internal'
import { callerIdentity, RateLimiter } from './rate-limit'
import {
  advertisedTools,
  normalizeJsonArguments,
  validateToolArguments,
  type JsonValue,
} from './tools'

const PROTOCOL_VERSIONS = [
  '2024-11-05',
  '2025-03-26',
  '2025-06-18',
] as const
const SERVER_NAME = 'loora'
const SERVER_VERSION = '0.3.0'
const MAX_BODY_BYTES = 32 * 1024 * 1024
const CORS_MAX_AGE = '86400'

type JsonRpcId = string | number | null

type JsonRpcRequest = {
  jsonrpc?: unknown
  id?: JsonRpcId
  method?: unknown
  params?: unknown
}

export type AppState = {
  config: Config
  auth: AuthVerifier
  rates: RateLimiter
  fetchImpl: FetchImpl
}

export function createAppState(
  config: Config,
  options: {
    fetchImpl?: FetchImpl
    rates?: RateLimiter
  } = {},
): AppState {
  const fetchImpl = options.fetchImpl ?? fetch
  return {
    config,
    auth: new AuthVerifier({
      authOrigin: config.authOrigin,
      timeoutMs: config.authTimeoutMs,
      cacheTtlMs: config.authCacheTtlMs,
      fetchImpl,
    }),
    rates: options.rates ?? new RateLimiter({ redisUrl: config.redisUrl }),
    fetchImpl,
  }
}

export function stateFromEnv(env: Env | NodeJS.ProcessEnv): AppState {
  const config = configFrom((key) => envValue(env, key))
  const workerEnv = env as Env
  return createAppState(config, {
    rates: new RateLimiter({
      redisUrl: config.redisUrl,
      bindings: {
        mcp: workerEnv.MCP_ACCOUNT,
        'mcp-address': workerEnv.MCP_ADDRESS,
        'mcp-anonymous': workerEnv.MCP_ANONYMOUS,
      },
    }),
  })
}

export async function handleRequest(request: Request, state: AppState) {
  if (request.method === 'OPTIONS') {
    return cors(new Response(null, { status: 204 }))
  }
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  if (request.method === 'GET' && (path === '/' || path === '/health')) {
    return cors(json(200, {
      name: 'loora-mcp',
      endpoint: `${state.config.publicUrl}/mcp`,
    }))
  }
  if (request.method === 'GET' && path === '/ready') {
    let ready = false
    try {
      await callInternal(state.config, { action: 'ready' }, state.fetchImpl)
      ready = true
    } catch {
      ready = false
    }
    return cors(json(ready ? 200 : 503, { service: 'mcp', ready }))
  }
  if (
    request.method === 'GET' &&
    (path === '/.well-known/oauth-protected-resource' ||
      path === '/.well-known/oauth-protected-resource/mcp')
  ) {
    return cors(json(200, {
      resource: `${state.config.publicUrl}/mcp`,
      authorization_servers: [state.config.authorizationServerUrl],
      bearer_methods_supported: ['header'],
    }))
  }
  if (path === '/mcp') return cors(await handleMcp(request, state))
  return cors(json(404, { error: 'Not found' }))
}

async function handleMcp(request: Request, state: AppState) {
  if (request.method !== 'POST') {
    return json(405, rpcError('Method not allowed'))
  }
  if (!hostAllowed(request, state.config.publicUrl)) {
    return json(403, rpcError('Forbidden host'))
  }
  const length = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return json(413, rpcError('Request body too large'))
  }

  const address = callerIdentity(request.headers)
  const byAddress = await state.rates.check('mcp-address', address)
  if (!byAddress.ok) return rateLimited(byAddress)

  let userId: string
  try {
    const session = await state.auth.getSession(request.headers)
    userId = session.userId
  } catch (error) {
    const code = authErrorCode(error)
    if (code === 'unavailable') {
      return json(
        503,
        rpcError(
          'Authentication service is temporarily unavailable. Try again shortly.',
        ),
        { 'Retry-After': '1' },
      )
    }
    const anonymous = await state.rates.check('mcp-anonymous', address)
    if (!anonymous.ok) return rateLimited(anonymous)
    return json(401, rpcError('Unauthorized: Authentication required'), {
      'WWW-Authenticate': `Bearer resource_metadata="${state.config.publicUrl}/.well-known/oauth-protected-resource"`,
    })
  }

  const byAccount = await state.rates.check('mcp', `user:${userId}`)
  if (!byAccount.ok) return rateLimited(byAccount)

  try {
    await callInternal(
      state.config,
      { action: 'access', userId },
      state.fetchImpl,
    )
  } catch (error) {
    const message =
      error instanceof InternalMcpError
        ? error.message
        : "Loora's MCP execution service rejected the request."
    return json(403, rpcError(message))
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return json(400, rpcError('Invalid JSON body'))
  }

  if (Array.isArray(payload)) {
    const responses = []
    for (const entry of payload) {
      const result = await dispatchRpc(entry, state, userId)
      if (result) responses.push(result.body)
    }
    if (responses.length === 0) return new Response(null, { status: 202 })
    return json(200, responses)
  }

  const result = await dispatchRpc(payload, state, userId)
  if (!result) return new Response(null, { status: 202 })
  return json(result.status, result.body)
}

async function dispatchRpc(
  payload: unknown,
  state: AppState,
  userId: string,
): Promise<{ status: number; body: JsonValue } | null> {
  const request = payload as JsonRpcRequest
  const id = (request?.id ?? null) as JsonRpcId
  const isNotification = request == null || request.id === undefined
  if (request?.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    if (isNotification) return null
    return { status: 200, body: rpcError('Invalid Request', id, -32600) }
  }
  const method = request.method
  if (method === 'notifications/initialized' || method.startsWith('notifications/')) {
    return isNotification ? null : { status: 200, body: { jsonrpc: '2.0', id, result: {} } }
  }
  try {
    const result = await callMethod(method, request.params, state, userId)
    if (isNotification) return null
    return { status: 200, body: { jsonrpc: '2.0', id, result } }
  } catch (error) {
    if (error instanceof RpcMethodError) {
      if (isNotification) return null
      return {
        status: 200,
        body: rpcError(error.message, id, error.code),
      }
    }
    const message = error instanceof Error ? error.message : 'Internal error'
    if (isNotification) return null
    return { status: 200, body: rpcError(message, id, -32603) }
  }
}

class RpcMethodError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message)
    this.name = 'RpcMethodError'
  }
}

async function callMethod(
  method: string,
  params: unknown,
  state: AppState,
  userId: string,
): Promise<JsonValue> {
  if (method === 'initialize') {
    const requested =
      params &&
      typeof params === 'object' &&
      !Array.isArray(params) &&
      typeof (params as { protocolVersion?: unknown }).protocolVersion === 'string'
        ? (params as { protocolVersion: string }).protocolVersion
        : PROTOCOL_VERSIONS[PROTOCOL_VERSIONS.length - 1]
    const protocolVersion = PROTOCOL_VERSIONS.includes(
      requested as (typeof PROTOCOL_VERSIONS)[number],
    )
      ? requested
      : PROTOCOL_VERSIONS[PROTOCOL_VERSIONS.length - 1]
    return {
      protocolVersion,
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    }
  }
  if (method === 'ping') return {}
  if (method === 'tools/list') {
    return { tools: advertisedTools as unknown as JsonValue }
  }
  if (method === 'tools/call') {
    const name =
      params &&
      typeof params === 'object' &&
      !Array.isArray(params) &&
      typeof (params as { name?: unknown }).name === 'string'
        ? (params as { name: string }).name
        : ''
    if (!name) throw new RpcMethodError('Invalid params', -32602)
    const rawArguments =
      params &&
      typeof params === 'object' &&
      !Array.isArray(params) &&
      (params as { arguments?: unknown }).arguments !== undefined
        ? ((params as { arguments?: JsonValue }).arguments ?? {})
        : {}
    const args: JsonValue =
      rawArguments && typeof rawArguments === 'object' ? structuredClone(rawArguments) : {}
    normalizeJsonArguments(args)
    const invalid = validateToolArguments(name, args)
    if (invalid) {
      return {
        content: [
          { type: 'text', text: `Invalid arguments for tool ${name}: ${invalid}` },
        ],
        isError: true,
      }
    }
    try {
      return await callInternal(
        state.config,
        { action: 'execute', userId, tool: name, arguments: args },
        state.fetchImpl,
      )
    } catch (error) {
      const text =
        error instanceof InternalMcpError
          ? error.message
          : "Loora's MCP execution service is temporarily unavailable."
      return {
        content: [{ type: 'text', text }],
        isError: true,
      }
    }
  }
  throw new RpcMethodError('Method not found', -32601)
}

function hostAllowed(request: Request, publicUrl: string) {
  const allowed = new Set(['localhost', '127.0.0.1', '::1'])
  try {
    allowed.add(new URL(publicUrl).hostname)
  } catch {
    // Config already validated the public URL.
  }
  try {
    allowed.add(new URL(request.url).hostname)
  } catch {
    // Fall through to the Host header allow-list.
  }
  const host = requestHost(request.headers.get('host'))
  if (!host) return false
  if (host.startsWith('loora-mcp.') && host.endsWith('.workers.dev')) return true
  return allowed.has(host)
}

function requestHost(value: string | null) {
  if (!value) return null
  const host = value.trim()
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    return end >= 0 ? host.slice(1, end) : host
  }
  const colon = host.lastIndexOf(':')
  if (colon > 0 && /^\d+$/.test(host.slice(colon + 1))) {
    return host.slice(0, colon)
  }
  return host
}

function rateLimited(decision: {
  retryAfter: number
  limit: number
  remaining: number
}) {
  return json(429, rpcError('Too many requests. Try again shortly.'), {
    'Retry-After': String(decision.retryAfter),
    'X-RateLimit-Limit': String(decision.limit),
    'X-RateLimit-Remaining': String(decision.remaining),
  })
}

function rpcError(message: string, id: JsonRpcId = null, code = -32000): JsonValue {
  return { jsonrpc: '2.0', error: { code, message }, id }
}

function json(
  status: number,
  value: JsonValue,
  extra: Record<string, string> = {},
) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json',
      ...extra,
    },
  })
}

function cors(response: Response) {
  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  headers.set('Access-Control-Allow-Headers', '*')
  headers.set('Access-Control-Max-Age', CORS_MAX_AGE)
  headers.set(
    'Access-Control-Expose-Headers',
    'WWW-Authenticate, mcp-session-id, server-timing, x-request-id',
  )
  return new Response(response.body, { status: response.status, headers })
}
