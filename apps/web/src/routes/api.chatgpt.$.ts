import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { requireSession } from '@loora/auth'
import { chatgptAuth } from '@loora/auth/chatgpt'
import { isInAppAgentEnabled } from '@loora/railway'
import { authorizeBilling, subscriptionRequiredResponse } from '@loora/billing/billing'
import { canUseApp, previewAccessRequiredResponse } from '@loora/auth/preview-access'
import {
  hasAcceptedCurrentLegal,
  legalConsentRequiredResponse,
} from '@loora/auth/legal-consent'
import {
  callerIdentity,
  rateLimit,
  rateLimits,
  tooManyRequestsResponse,
} from '@loora/rpc/rate-limit'

async function handle(request: Request) {
  const decision = await rateLimit(
    'chatgpt',
    callerIdentity(request.headers),
    rateLimits.chatgpt,
  )
  if (!decision.ok) return tooManyRequestsResponse(decision)

  const session = await requireSession(request)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await isInAppAgentEnabled(session.user))) {
    return Response.json({ error: 'The agent is not available.' }, { status: 403 })
  }
  if (!hasAcceptedCurrentLegal(session.user)) return legalConsentRequiredResponse()
  if (!canUseApp(session.user)) return previewAccessRequiredResponse()
  if (!(await authorizeBilling(session.user)).access) {
    return subscriptionRequiredResponse()
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
