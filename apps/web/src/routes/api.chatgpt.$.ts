import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { requireSession } from '@loora/auth'
import { chatgptAuth } from '@loora/auth/chatgpt-auth'
import { authorizeBilling, subscriptionRequiredResponse } from '@loora/auth/billing'
import { canUseApp, previewAccessRequiredResponse } from '@loora/auth/preview-access'

async function handle(request: Request) {
  const session = await requireSession(request)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canUseApp(session.user)) return previewAccessRequiredResponse()
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
