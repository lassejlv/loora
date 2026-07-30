// Remote MCP server (Streamable HTTP) for mcp.loora.design. OAuth 2.1
// resource server: loora.design (Better Auth `mcp` plugin) is the
// authorization server; access tokens are validated here against the shared
// database via auth.api.getMcpSession. Stateless — every POST gets a fresh
// server + transport pair, so any instance can serve any request.
//
// node:http instead of Bun.serve because the MCP SDK's
// StreamableHTTPServerTransport speaks IncomingMessage/ServerResponse.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { checkDatabaseConnection } from '@loora/db'
import { serviceReadinessResponse } from '@loora/rpc/readiness'
import {
  elapsedMilliseconds,
  logRequestTiming,
  requestIdFromHeaders,
  serverTimingHeader,
} from '@loora/rpc/request-timing'
import { createLooraServer } from './server'
import { AccessDeniedError, requireAppAccess } from './access'
import { createMcpSessionVerifier } from './auth'
import { createMcpUsageController } from './usage'

const PORT = Number(process.env.PORT ?? 4100)
const PUBLIC_URL = (process.env.MCP_PUBLIC_URL?.trim() || `http://localhost:${PORT}`).replace(
  /\/+$/,
  '',
)
const AUTH_ORIGIN = new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').origin
const RESOURCE = `${PUBLIC_URL}/mcp`
const mcpSessionVerifier = createMcpSessionVerifier(AUTH_ORIGIN)

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id',
  'Access-Control-Expose-Headers':
    'WWW-Authenticate, Mcp-Session-Id, Server-Timing, X-Request-Id',
  'Access-Control-Max-Age': '86400',
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS, ...headers })
  res.end(JSON.stringify(body))
}

function sendUnauthorized(res: ServerResponse, message: string) {
  const wwwAuthenticate = `Bearer resource_metadata="${PUBLIC_URL}/.well-known/oauth-protected-resource"`
  sendJson(
    res,
    401,
    { jsonrpc: '2.0', error: { code: -32000, message }, id: null },
    { 'WWW-Authenticate': wwwAuthenticate },
  )
}

async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
  phases: Record<string, number>,
) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value)
    else if (Array.isArray(value)) for (const item of value) headers.append(key, item)
  }
  const authStartedAt = performance.now()
  const session = await mcpSessionVerifier.getSession(headers)
  phases.auth = elapsedMilliseconds(authStartedAt)
  if (!session) {
    res.setHeader(
      'Server-Timing',
      serverTimingHeader([{ name: 'auth', durationMs: phases.auth }]),
    )
    sendUnauthorized(res, 'Unauthorized: Authentication required')
    return
  }

  let userId: string
  let mcpPlan: Awaited<ReturnType<typeof requireAppAccess>>['mcpPlan']
  const accessStartedAt = performance.now()
  try {
    const access = await requireAppAccess(session.userId)
    userId = access.account.id
    mcpPlan = access.mcpPlan
    phases.access = elapsedMilliseconds(accessStartedAt)
  } catch (error) {
    phases.access = elapsedMilliseconds(accessStartedAt)
    if (error instanceof AccessDeniedError) {
      res.setHeader(
        'Server-Timing',
        serverTimingHeader([
          { name: 'auth', durationMs: phases.auth },
          { name: 'access', durationMs: phases.access ?? 0 },
        ]),
      )
      sendJson(res, 403, { jsonrpc: '2.0', error: { code: -32000, message: error.message }, id: null })
      return
    }
    throw error
  }

  const setupStartedAt = performance.now()
  const server = createLooraServer(
    userId,
    createMcpUsageController(userId, mcpPlan),
    mcpPlan,
  )
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  phases.setup = elapsedMilliseconds(setupStartedAt)
  res.on('close', () => {
    void transport.close()
    void server.close()
  })
  for (const [key, value] of Object.entries(CORS_HEADERS)) res.setHeader(key, value)
  res.setHeader(
    'Server-Timing',
    serverTimingHeader([
      { name: 'auth', durationMs: phases.auth },
      { name: 'access', durationMs: phases.access },
      { name: 'setup', durationMs: phases.setup },
    ]),
  )
  await server.connect(transport)
  await transport.handleRequest(req, res)
}

const httpServer = createServer((req, res) => {
  const startedAt = performance.now()
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value)
    else if (Array.isArray(value)) for (const item of value) headers.append(key, item)
  }
  const requestId = requestIdFromHeaders(headers)
  const phases: Record<string, number> = {}
  const requestPath = new URL(req.url ?? '/', PUBLIC_URL).pathname
  res.setHeader('X-Request-Id', requestId)
  res.once('finish', () => {
    if (
      res.statusCode < 400 &&
      (requestPath === '/' ||
        requestPath === '/health' ||
        requestPath === '/ready')
    ) {
      return
    }
    logRequestTiming({
      service: 'mcp',
      requestId,
      method: req.method ?? 'UNKNOWN',
      path: requestPath,
      status: res.statusCode,
      durationMs: elapsedMilliseconds(startedAt),
      phases,
    })
  })
  void (async () => {
    const url = new URL(req.url ?? '/', PUBLIC_URL)

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS)
      res.end()
      return
    }

    // RFC 9728: clients probe both the root form and the path-suffix form
    // (/.well-known/oauth-protected-resource/mcp) depending on the endpoint
    // URL they were given.
    if (
      req.method === 'GET' &&
      (url.pathname === '/.well-known/oauth-protected-resource' ||
        url.pathname === '/.well-known/oauth-protected-resource/mcp')
    ) {
      sendJson(res, 200, {
        resource: RESOURCE,
        authorization_servers: [AUTH_ORIGIN],
        bearer_methods_supported: ['header'],
      })
      return
    }

    if (url.pathname === '/mcp') {
      if (req.method !== 'POST') {
        // Stateless mode: no SSE stream to GET, no session to DELETE.
        sendJson(res, 405, {
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Method not allowed' },
          id: null,
        })
        return
      }
      await handleMcp(req, res, phases)
      return
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      sendJson(res, 200, { name: 'loora-mcp', endpoint: `${PUBLIC_URL}/mcp` })
      return
    }

    if (req.method === 'GET' && url.pathname === '/ready') {
      const response = await serviceReadinessResponse(
        'mcp',
        checkDatabaseConnection,
      )
      const body = await response.text()
      res.writeHead(
        response.status,
        Object.fromEntries(response.headers.entries()),
      )
      res.end(body)
      return
    }

    sendJson(res, 404, { error: 'Not found' })
  })().catch((error) => {
    console.error('[loora-mcp]', error)
    if (!res.headersSent) {
      sendJson(res, 500, {
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      })
    } else {
      res.end()
    }
  })
})

httpServer.listen(PORT, () => {
  console.log(`[loora-mcp] listening on :${PORT} — endpoint ${RESOURCE}, auth ${AUTH_ORIGIN}`)
})
