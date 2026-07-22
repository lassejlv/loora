import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { handleAgentChatGPTRequest } from '@loora/agent/server'

export const Route = createFileRoute('/api/chatgpt/$')({
  server: {
    handlers: {
      GET: ({ request }) => handleAgentChatGPTRequest(request),
      POST: ({ request }) => handleAgentChatGPTRequest(request),
    },
  },
})
