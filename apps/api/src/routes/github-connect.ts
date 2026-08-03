import { requireSession } from '@loora/auth'
import { createGitHubOAuthFlow } from '@loora/auth/github'
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

export async function handleGitHubConnect(request: Request) {
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

  try {
    const flow = await createGitHubOAuthFlow(session.user.id)
    return new Response(null, {
      status: 302,
      headers: { Location: flow.url, 'Set-Cookie': flow.cookie },
    })
  } catch {
    return Response.redirect(
      new URL('/app/integrations?integration=github&github=unavailable', appOrigin),
      302,
    )
  }
}
