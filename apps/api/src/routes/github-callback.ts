import { requireSession } from '@loora/auth'
import {
  clearGitHubFlowCookie,
  exchangeGitHubCode,
  getGitHubUser,
  githubFlowCookie,
  saveGitHubAccount,
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

function redirect(result: string, cookie?: string) {
  const headers: Record<string, string> = {
    Location: new URL(
      `/app/integrations?integration=github&github=${result}`,
      appOrigin,
    ).toString(),
  }
  if (cookie) headers['Set-Cookie'] = cookie
  return new Response(null, { status: 302, headers })
}

export async function handleGitHubCallback(request: Request) {
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
  if (url.searchParams.get('error')) {
    return redirect('cancelled', clearGitHubFlowCookie(githubFlowCookie.oauth))
  }
  try {
    const flow = await verifyGitHubFlow(
      request.headers.get('cookie'),
      githubFlowCookie.oauth,
      'oauth',
      url.searchParams.get('state'),
      session.user.id,
    )
    const code = url.searchParams.get('code')
    if (!code || !flow.verifier) throw new Error('Missing GitHub code')
    const tokens = await exchangeGitHubCode(code, flow.verifier)
    const profile = await getGitHubUser(tokens.accessToken)
    await saveGitHubAccount(session.user.id, profile, tokens)
    const installations = await syncGitHubInstallations(session.user.id)
    if (installations.length === 0) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: new URL('/api/github/install', request.url).toString(),
          'Set-Cookie': clearGitHubFlowCookie(githubFlowCookie.oauth),
        },
      })
    }
    return redirect('connected', clearGitHubFlowCookie(githubFlowCookie.oauth))
  } catch {
    return redirect('failed', clearGitHubFlowCookie(githubFlowCookie.oauth))
  }
}
