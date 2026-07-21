import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { requireSession } from '@loora/auth'
import { authorizeBilling, subscriptionRequiredResponse } from '@loora/auth/billing'
import { canUseApp, previewAccessRequiredResponse } from '@loora/auth/preview-access'
import {
  clearFigmaFlowCookie,
  exchangeFigmaCode,
  saveFigmaAccount,
  verifyFigmaFlow,
} from '@loora/auth/figma'

function redirect(request: Request, path: string, result: string) {
  const target = new URL(path, request.url)
  target.searchParams.set('figma', result)
  return new Response(null, {
    status: 302,
    headers: { Location: target.toString(), 'Set-Cookie': clearFigmaFlowCookie() },
  })
}

export const Route = createFileRoute('/api/figma/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
        if (!canUseApp(session.user)) return previewAccessRequiredResponse()
        if (!(await authorizeBilling(session.user)).access) return subscriptionRequiredResponse()

        const url = new URL(request.url)
        let returnTo = '/?figmaImport=true'
        try {
          const flow = await verifyFigmaFlow(
            request.headers.get('cookie'),
            url.searchParams.get('state'),
            session.user.id,
          )
          returnTo = flow.returnTo
          if (url.searchParams.get('error')) return redirect(request, returnTo, 'cancelled')
          const code = url.searchParams.get('code')
          if (!code) throw new Error('Missing Figma code')
          const tokens = await exchangeFigmaCode(code, flow.verifier)
          await saveFigmaAccount(session.user.id, tokens)
          return redirect(request, returnTo, 'connected')
        } catch {
          return redirect(request, returnTo, 'failed')
        }
      },
    },
  },
})
