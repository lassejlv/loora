import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { requireSession } from '#/lib/auth'
import { chatgptAuth } from '#/lib/chatgpt-auth'
import { authorizeBilling, subscriptionRequiredResponse } from '#/lib/billing'

async function handle(request: Request) {
  const session = await requireSession(request)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await authorizeBilling(session.user)).access) return subscriptionRequiredResponse()
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
