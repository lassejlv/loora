import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { chatgptAuth } from '#/lib/chatgpt-auth'

export const Route = createFileRoute('/api/chatgpt/$')({
  server: {
    handlers: {
      GET: ({ request }) => chatgptAuth.handler(request),
      POST: ({ request }) => chatgptAuth.handler(request),
    },
  },
})
