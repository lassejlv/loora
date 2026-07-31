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
  clearGitHubFlowCookie,
  githubFlowCookie,
  syncGitHubInstallations,
  verifyGitHubFlow,
} from '@loora/auth/github'
import {
  callerIdentity,
  rateLimit,
  rateLimits,
  tooManyRequestsResponse,
} from '@loora/rpc/rate-limit'

function finish(request: Request, result: string) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: new URL(
        `/app/integrations?integration=github&github=${result}`,
        request.url,
      ).toString(),
      'Set-Cookie': clearGitHubFlowCookie(githubFlowCookie.install),
    },
  })
}

export const Route = createFileRoute('/api/github/setup')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const decision = await rateLimit(
          'github',
          callerIdentity(request.headers),
          rateLimits.github,
        )
        if (!decision.ok) return tooManyRequestsResponse(decision)

        const session = await requireSession(request)
        if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
        if (!hasAcceptedCurrentLegal(session.user)) return legalConsentRequiredResponse()
        if (!canUseApp(session.user)) return previewAccessRequiredResponse()
        if (!(await authorizeBilling(session.user)).access) return subscriptionRequiredResponse()

        const url = new URL(request.url)
        try {
          // GitHub preserves state for Loora-initiated installs. A direct
          // installation update may omit it, so the live user-token ownership
          // check below remains the final authority in both cases.
          if (url.searchParams.has('state')) {
            await verifyGitHubFlow(
              request.headers.get('cookie'),
              githubFlowCookie.install,
              'install',
              url.searchParams.get('state'),
              session.user.id,
            )
          }
          const installationId = url.searchParams.get('installation_id')
          if (!installationId) throw new Error('Missing installation')
          const installations = await syncGitHubInstallations(session.user.id)
          if (!installations.some((installation) => String(installation.id) === installationId)) {
            throw new Error('Installation does not belong to user')
          }
          return finish(request, 'connected')
        } catch {
          return finish(request, 'failed')
        }
      },
    },
  },
})
