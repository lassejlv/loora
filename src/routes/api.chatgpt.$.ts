import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { requireSession } from '#/lib/auth'
import { chatgptAuth } from '#/lib/chatgpt-auth'
import { canUseApp } from '#/lib/preview-access'

async function handle(request: Request) {
  const session = await requireSession(request)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canUseApp(session.user)) {
    return Response.json({ error: 'Preview access is required.' }, { status: 403 })
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

