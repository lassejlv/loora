import { onError } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { auth, getSession, mcpOAuthDiscoveryHandler } from '@loora/auth'
import { checkDatabaseConnection } from '@loora/db'
import {
  canUseApp,
  isPreviewProtectedAuthPath,
  previewAccessRequiredResponse,
} from '@loora/auth/preview-access'
import {
  hasAcceptedCurrentLegal,
  isLegalProtectedAuthPath,
  legalConsentRequiredResponse,
} from '@loora/auth/legal-consent'
import { requireMcpConsent } from '@loora/auth/mcp-consent'
import { appRouter } from '@loora/rpc'
import { serviceReadinessResponse } from '@loora/rpc/readiness'
import {
  elapsedMilliseconds,
  logRequestTiming,
  requestIdFromHeaders,
  withRequestTimingHeaders,
} from '@loora/rpc/request-timing'
import {
  callerIdentity,
  clientAddress,
  rateLimit,
  rateLimits,
  tooManyRequestsResponse,
  UNKNOWN_ADDRESS,
} from '@loora/rpc/rate-limit'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { handleAssetRequest } from './routes/asset'
import { canvasEventsResponse } from './routes/api.canvas-events'
import { canvasPresenceResponse } from './routes/api.canvas-presence'
import { realtimeTicketResponse } from './routes/api.realtime-ticket'
import {
  handleCustomDomainSiteHeadRequest,
  handleCustomDomainSiteRequest,
} from './routes/custom-domain-site'
import { handleCustomDomainSyncRequest } from './routes/custom-domain-sync'
import { handleGitHubCallback } from './routes/github-callback'
import { handleGitHubConnect } from './routes/github-connect'
import { handleGitHubInstall } from './routes/github-install'
import { handleGitHubSetup } from './routes/github-setup'
import { handleGitHubWebhook } from './routes/github-webhook'
import { handleHandoffAssetRequest } from './routes/handoff-asset'
import {
  handleHandoffOptionsRequest,
  handleHandoffRequest,
} from './routes/handoff'
import { handleInternalMcpRequest } from './routes/internal-mcp'

const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3000', 'https://loora.design']

function commaSeparated(value: string | undefined) {
  return value?.split(',').map((entry) => entry.trim()).filter(Boolean) ?? []
}

const configuredAllowedOrigins = commaSeparated(process.env.API_ALLOWED_ORIGINS)
const allowedOrigins = new Set(
  configuredAllowedOrigins.length > 0
    ? configuredAllowedOrigins
    : DEFAULT_ALLOWED_ORIGINS,
)

const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [onError((error) => console.error('[orpc]', error))],
})

const CREDENTIAL_PATHS = [
  '/sign-in/email',
  '/sign-in/username',
  '/sign-up/email',
  '/forget-password',
  '/reset-password',
  '/change-password',
  '/change-email',
  '/send-verification-email',
  '/two-factor/verify-totp',
  '/two-factor/verify-otp',
  '/email-otp/send-verification-otp',
  '/email-otp/verify-email',
  '/one-time-token/verify',
]

function isCredentialPath(pathname: string) {
  return CREDENTIAL_PATHS.some((path) => pathname.endsWith(path))
}

async function handleRpc(request: Request) {
  const startedAt = performance.now()
  const requestId = requestIdFromHeaders(request.headers)
  const sessionStartedAt = performance.now()
  const session = await getSession(request)
  const sessionMs = elapsedMilliseconds(sessionStartedAt)
  const userId = session?.user?.id ?? null
  const decision = await rateLimit(
    userId ? 'rpc' : 'rpc-anonymous',
    callerIdentity(request.headers, userId),
    userId ? rateLimits.rpc : rateLimits.rpcAnonymous,
  )
  if (!decision.ok) return tooManyRequestsResponse(decision)

  const handlerStartedAt = performance.now()
  const { response } = await rpcHandler.handle(request, {
    prefix: '/api/rpc',
    context: { session },
  })
  const handlerMs = elapsedMilliseconds(handlerStartedAt)
  const resolved = response ?? new Response('Not Found', { status: 404 })
  const totalMs = elapsedMilliseconds(startedAt)
  logRequestTiming({
    service: 'api',
    requestId,
    method: request.method,
    path: new URL(request.url).pathname,
    status: resolved.status,
    durationMs: totalMs,
    phases: { session: sessionMs, handler: handlerMs },
  })

  return withRequestTimingHeaders(resolved, requestId, [
    { name: 'session', durationMs: sessionMs },
    { name: 'handler', durationMs: handlerMs },
    { name: 'total', durationMs: totalMs },
  ])
}

async function handleAuth(request: Request) {
  const pathname = new URL(request.url).pathname
  const address = clientAddress(request.headers)
  const credential = isCredentialPath(pathname) && address !== UNKNOWN_ADDRESS
  const decision = await rateLimit(
    credential ? 'auth-credentials' : 'auth',
    `ip:${address}`,
    credential ? rateLimits.authSensitive : rateLimits.auth,
  )
  if (!decision.ok) {
    return tooManyRequestsResponse(
      decision,
      'Too many attempts. Wait a moment and try again.',
    )
  }

  if (isLegalProtectedAuthPath(pathname) || isPreviewProtectedAuthPath(pathname)) {
    const session = await getSession(request)
    if (
      session &&
      isLegalProtectedAuthPath(pathname) &&
      !hasAcceptedCurrentLegal(session.user)
    ) {
      return legalConsentRequiredResponse()
    }
    if (session && !canUseApp(session.user)) return previewAccessRequiredResponse()
  }

  // Returning Better Auth's Fetch Response directly preserves every Set-Cookie header.
  return auth.handler(requireMcpConsent(request))
}

const app = new Hono()

// Handoff payloads are capability URLs consumed by arbitrary agent origins.
app.options('/api/handoff/:token', (context) =>
  handleHandoffOptionsRequest(context.req.raw),
)
app.get('/api/handoff/:token', (context) =>
  handleHandoffRequest(context.req.raw, context.req.param('token')),
)
app.get('/api/handoff/:token/asset/:id', (context) =>
  handleHandoffAssetRequest(
    context.req.raw,
    context.req.param('token'),
    context.req.param('id'),
  ),
)

app.use('/api/*', cors({
  origin: (origin) => allowedOrigins.has(origin) ? origin : undefined,
  credentials: true,
}))

app.get('/api/ready', () => serviceReadinessResponse('api', checkDatabaseConnection))
app.get('/.well-known/oauth-authorization-server', (context) =>
  mcpOAuthDiscoveryHandler(context.req.raw),
)
app.all('/api/rpc/*', (context) => handleRpc(context.req.raw))
app.on(['GET', 'POST'], '/api/auth/*', (context) => handleAuth(context.req.raw))
app.get('/api/asset/:id', (context) =>
  handleAssetRequest(context.req.raw, context.req.param('id')),
)
app.post('/api/realtime-ticket', (context) => realtimeTicketResponse(context.req.raw))
app.get('/api/canvas-events', (context) => canvasEventsResponse(context.req.raw))
app.post('/api/canvas-presence', (context) => canvasPresenceResponse(context.req.raw))
app.get('/api/github/connect', (context) => handleGitHubConnect(context.req.raw))
app.get('/api/github/callback', (context) => handleGitHubCallback(context.req.raw))
app.get('/api/github/install', (context) => handleGitHubInstall(context.req.raw))
app.get('/api/github/setup', (context) => handleGitHubSetup(context.req.raw))
app.post('/api/github/webhook', (context) => handleGitHubWebhook(context.req.raw))
app.post('/api/internal/mcp', (context) => handleInternalMcpRequest(context.req.raw))
app.post('/api/internal/custom-domain-sync', (context) =>
  handleCustomDomainSyncRequest(context.req.raw),
)
app.get('/api/custom-domain-site', (context) =>
  handleCustomDomainSiteRequest(context.req.raw),
)
app.on('HEAD', '/api/custom-domain-site', (context) =>
  handleCustomDomainSiteHeadRequest(context.req.raw),
)

const port = Number(process.env.PORT || 3001)

export { app }

export default {
  port,
  hostname: process.env.HOST || '0.0.0.0',
  fetch: app.fetch,
}
