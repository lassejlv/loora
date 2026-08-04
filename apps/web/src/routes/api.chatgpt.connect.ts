import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { requireSession } from '@loora/auth'
import { authorizeBilling, subscriptionRequiredResponse } from '@loora/billing/billing'
import { canUseApp, previewAccessRequiredResponse } from '@loora/auth/preview-access'
import {
  hasAcceptedCurrentLegal,
  legalConsentRequiredResponse,
} from '@loora/auth/legal-consent'
import { createChatGptOAuthFlow } from '@loora/auth/chatgpt'
import {
  callerIdentity,
  rateLimit,
  rateLimits,
  tooManyRequestsResponse,
} from '@loora/rpc/rate-limit'

/**
 * Start of "Sign in with ChatGPT". The same gates as every other integration
 * connect route, then a 302 carrying a one-flow cookie — the PKCE verifier
 * never touches the URL.
 */
export const Route = createFileRoute('/api/chatgpt/connect')({
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

        const returnTo =
          new URL(request.url).searchParams.get('returnTo') ?? undefined
        try {
          const flow = await createChatGptOAuthFlow(session.user.id, returnTo)
          return new Response(null, {
            status: 302,
            headers: { Location: flow.url, 'Set-Cookie': flow.cookie },
          })
        } catch {
          return Response.redirect(
            new URL(
              '/app/integrations?integration=chatgpt&chatgpt=unavailable',
              request.url,
            ),
            302,
          )
        }
      },
    },
  },
})
