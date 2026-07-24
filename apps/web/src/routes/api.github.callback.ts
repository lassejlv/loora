import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { requireSession } from '@loora/auth'
import { authorizeBilling, subscriptionRequiredResponse } from '@loora/billing/billing'
import { canUseApp, previewAccessRequiredResponse } from '@loora/auth/preview-access'
import {
  clearGitHubFlowCookie,
  exchangeGitHubCode,
  getGitHubUser,
  githubFlowCookie,
  saveGitHubAccount,
  syncGitHubInstallations,
  verifyGitHubFlow,
} from '@loora/auth/github'

function redirect(request: Request, result: string, cookie?: string) {
  const headers: Record<string, string> = {
    Location: new URL(
      `/?settings=integrations&integration=github&github=${result}`,
      request.url,
    ).toString(),
  }
  if (cookie) headers['Set-Cookie'] = cookie
  return new Response(null, { status: 302, headers })
}

export const Route = createFileRoute('/api/github/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
        if (!canUseApp(session.user)) return previewAccessRequiredResponse()
        if (!(await authorizeBilling(session.user)).access) return subscriptionRequiredResponse()

        const url = new URL(request.url)
        if (url.searchParams.get('error')) {
          return redirect(
            request,
            'cancelled',
            clearGitHubFlowCookie(githubFlowCookie.oauth),
          )
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
          return redirect(
            request,
            'connected',
            clearGitHubFlowCookie(githubFlowCookie.oauth),
          )
        } catch {
          return redirect(
            request,
            'failed',
            clearGitHubFlowCookie(githubFlowCookie.oauth),
          )
        }
      },
    },
  },
})
