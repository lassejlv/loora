import '@tanstack/react-start'
import { onError } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { createFileRoute } from '@tanstack/react-router'
import { getSession } from '@loora/auth'
import { appRouter } from '@loora/rpc'
import {
  elapsedMilliseconds,
  logRequestTiming,
  requestIdFromHeaders,
  withRequestTimingHeaders,
} from '@loora/rpc/request-timing'

const handler = new RPCHandler(appRouter, {
  interceptors: [onError((error) => console.error('[orpc]', error))],
})

async function handle(request: Request) {
  const startedAt = performance.now()
  const requestId = requestIdFromHeaders(request.headers)
  const sessionStartedAt = performance.now()
  const session = await getSession(request)
  const sessionMs = elapsedMilliseconds(sessionStartedAt)
  const handlerStartedAt = performance.now()
  const { response } = await handler.handle(request, {
    prefix: '/api/rpc',
    context: { session },
  })
  const handlerMs = elapsedMilliseconds(handlerStartedAt)
  const resolved = response ?? new Response('Not Found', { status: 404 })
  const totalMs = elapsedMilliseconds(startedAt)
  logRequestTiming({
    service: 'web',
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

export const Route = createFileRoute('/api/rpc/$')({
  server: {
    handlers: {
      ANY: ({ request }) => handle(request),
    },
  },
})
