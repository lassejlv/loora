import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { requireSession } from '@loora/auth'
import { authorizeBilling, subscriptionRequiredResponse } from '@loora/billing/billing'
import { canUseApp, previewAccessRequiredResponse } from '@loora/auth/preview-access'
import {
  hasAcceptedCurrentLegal,
  legalConsentRequiredResponse,
} from '@loora/auth/legal-consent'
import {
  clearChatGptFlowCookie,
  completeChatGptOAuth,
  verifyChatGptFlow,
} from '@loora/auth/chatgpt'
import {
  callerIdentity,
  rateLimit,
  rateLimits,
  tooManyRequestsResponse,
} from '@loora/rpc/rate-limit'

/**
 * Lands back where the flow started — the editor if the person typed
 * `/login-with-chatgpt` in the chat box, the integrations page otherwise — with
 * one query parameter saying how it went.
 */
function redirect(request: Request, returnTo: string, result: string) {
  const location = new URL(returnTo, request.url)
  location.searchParams.set('chatgpt', result)
  return new Response(null, {
    status: 302,
    headers: {
      Location: location.toString(),
      'Set-Cookie': clearChatGptFlowCookie(),
    },
  })
}

export const Route = createFileRoute('/api/chatgpt/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const decision = await rateLimit(
          'chatgpt',
          callerIdentity(request.headers),
          rateLimits.chatgpt,
        )
        if (!decision.ok) return tooManyRequestsResponse(decision)

        const session = await requireSession(request)
        if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
        if (!hasAcceptedCurrentLegal(session.user)) return legalConsentRequiredResponse()
        if (!canUseApp(session.user)) return previewAccessRequiredResponse()
        if (!(await authorizeBilling(session.user)).access) {
          return subscriptionRequiredResponse()
        }

        const url = new URL(request.url)
        // The flow cookie is the only place `returnTo` survives from, and it is
        // read before anything can fail — otherwise a cancelled sign-in would
        // drop somebody on the integrations page instead of back at their canvas.
        let returnTo = '/app/integrations'
        try {
          const flow = await verifyChatGptFlow(
            request.headers.get('cookie'),
            url.searchParams.get('state'),
            session.user.id,
          )
          returnTo = flow.returnTo
          if (url.searchParams.get('error')) {
            return redirect(request, returnTo, 'cancelled')
          }
          const code = url.searchParams.get('code')
          if (!code) throw new Error('Missing ChatGPT code')
          await completeChatGptOAuth({
            userId: session.user.id,
            code,
            verifier: flow.verifier,
          })
          return redirect(request, returnTo, 'connected')
        } catch {
          return redirect(request, returnTo, 'failed')
        }
      },
    },
  },
})
