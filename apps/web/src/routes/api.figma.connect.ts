import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { requireSession } from '@loora/auth'
import { authorizeBilling, subscriptionRequiredResponse } from '@loora/auth/billing'
import { canUseApp, previewAccessRequiredResponse } from '@loora/auth/preview-access'
import { createFigmaOAuthFlow } from '@loora/auth/figma'

export const Route = createFileRoute('/api/figma/connect')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
        if (!canUseApp(session.user)) return previewAccessRequiredResponse()
        if (!(await authorizeBilling(session.user)).access) return subscriptionRequiredResponse()

        try {
          const url = new URL(request.url)
          const flow = await createFigmaOAuthFlow(
            session.user.id,
            url.searchParams.get('returnTo') ?? undefined,
          )
          return new Response(null, {
            status: 302,
            headers: { Location: flow.url, 'Set-Cookie': flow.cookie },
          })
        } catch {
          return Response.redirect(
            new URL('/?settings=integrations&integration=figma&figma=unavailable', request.url),
            302,
          )
        }
      },
    },
  },
})
