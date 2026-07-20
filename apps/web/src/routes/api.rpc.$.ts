import '@tanstack/react-start'
import { onError } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { createFileRoute } from '@tanstack/react-router'
import { getSession } from '@loora/auth'
import { appRouter } from '@loora/rpc'

const handler = new RPCHandler(appRouter, {
  interceptors: [onError((error) => console.error('[orpc]', error))],
})

async function handle(request: Request) {
  const { response } = await handler.handle(request, {
    prefix: '/api/rpc',
    context: { session: await getSession(request) },
  })

  return response ?? new Response('Not Found', { status: 404 })
}

export const Route = createFileRoute('/api/rpc/$')({
  server: {
    handlers: {
      ANY: ({ request }) => handle(request),
    },
  },
})
