import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { chatgptAuth } from '#/lib/chatgpt-auth'
import { requireSession } from '#/lib/auth'

async function handle(request: Request) {
  if (!(await requireSession(request))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return chatgptAuth.handler(request)
}

export const Route = createFileRoute('/api/chatgpt/$')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
})
