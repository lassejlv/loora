import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { requireSession } from '@loora/auth'
import { authorizeBilling, subscriptionRequiredResponse } from '@loora/billing/billing'
import { canUseApp, previewAccessRequiredResponse } from '@loora/auth/preview-access'
import {
  hasAcceptedCurrentLegal,
  legalConsentRequiredResponse,
} from '@loora/auth/legal-consent'
import { createGitHubOAuthFlow } from '@loora/auth/github'

export const Route = createFileRoute('/api/github/connect')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
        if (!hasAcceptedCurrentLegal(session.user)) return legalConsentRequiredResponse()
        if (!canUseApp(session.user)) return previewAccessRequiredResponse()
        if (!(await authorizeBilling(session.user)).access) return subscriptionRequiredResponse()

        try {
          const flow = await createGitHubOAuthFlow(session.user.id)
          return new Response(null, {
            status: 302,
            headers: { Location: flow.url, 'Set-Cookie': flow.cookie },
          })
        } catch {
          return Response.redirect(
            new URL(
              '/app/integrations?integration=github&github=unavailable',
              request.url,
            ),
            302,
          )
        }
      },
    },
  },
})
