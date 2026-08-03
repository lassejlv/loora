import { requireSession } from '@loora/auth'
import {
  clearGitHubFlowCookie,
  githubFlowCookie,
  syncGitHubInstallations,
  verifyGitHubFlow,
} from '@loora/auth/github'
import {
  hasAcceptedCurrentLegal,
  legalConsentRequiredResponse,
} from '@loora/auth/legal-consent'
import { canUseApp, previewAccessRequiredResponse } from '@loora/auth/preview-access'
import { authorizeBilling, subscriptionRequiredResponse } from '@loora/billing/billing'
import {
  callerIdentity,
  rateLimit,
  rateLimits,
  tooManyRequestsResponse,
} from '@loora/rpc/rate-limit'

const appOrigin = process.env.APP_ORIGIN?.trim().replace(/\/+$/, '') || 'http://localhost:3000'

function finish(result: string) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: new URL(
        `/app/integrations?integration=github&github=${result}`,
        appOrigin,
      ).toString(),
      'Set-Cookie': clearGitHubFlowCookie(githubFlowCookie.install),
    },
  })
}

export async function handleGitHubSetup(request: Request) {
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
    // installation update may omit it, so user-token ownership remains final.
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
    return finish('connected')
  } catch {
    return finish('failed')
  }
}
