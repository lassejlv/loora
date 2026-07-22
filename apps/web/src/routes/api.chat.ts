import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { handleAgentChatRequest } from '@loora/agent/server'

type BunRuntimeRequest = Request & {
  runtime?: {
    bun?: {
      server?: {
        timeout(request: Request, seconds: number): void
      }
    }
  }
}

function allowLongRunningChatRequest(request: Request) {
  // Bun.serve defaults to 10 seconds of inactivity. A reasoning model can
  // legitimately take longer before emitting its first stream chunk.
  const bunServer = (request as BunRuntimeRequest).runtime?.bun?.server
  bunServer?.timeout(request, 0)
}

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        allowLongRunningChatRequest(request)
        return handleAgentChatRequest(request)
      },
    },
  },
})
