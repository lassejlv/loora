import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { requireSession } from '@loora/auth'
import { authorizeBilling, subscriptionRequiredResponse } from '@loora/auth/billing'
import { canUseApp, previewAccessRequiredResponse } from '@loora/auth/preview-access'
import { createGitHubOAuthFlow } from '@loora/auth/github'

export const Route = createFileRoute('/api/github/connect')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
        if (!canUseApp(session.user)) return previewAccessRequiredResponse()
        if (!(await authorizeBilling(session.user)).access) return subscriptionRequiredResponse()

        try {
          const flow = await createGitHubOAuthFlow(session.user.id)
          return new Response(null, {
            status: 302,
            headers: { Location: flow.url, 'Set-Cookie': flow.cookie },
          })
        } catch {
          return Response.redirect(new URL('/?settings=integrations&github=unavailable', request.url), 302)
        }
      },
    },
  },
})
