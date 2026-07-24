import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { handleAgentChatStreamResumeRequest } from '@loora/agent/server'

export const Route = createFileRoute('/api/chat/$chatId/stream')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleAgentChatStreamResumeRequest(request, params.chatId),
    },
  },
})
