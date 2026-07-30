import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { auth, getSession } from '@loora/auth'
import {
  canUseApp,
  isPreviewProtectedAuthPath,
  previewAccessRequiredResponse,
} from '@loora/auth/preview-access'
import {
  hasAcceptedCurrentLegal,
  isLegalProtectedAuthPath,
  legalConsentRequiredResponse,
} from '@loora/auth/legal-consent'
import { requireMcpConsent } from '@loora/auth/mcp-consent'

async function handle(request: Request) {
  const pathname = new URL(request.url).pathname
  if (isLegalProtectedAuthPath(pathname) || isPreviewProtectedAuthPath(pathname)) {
    const session = await getSession(request)
    if (
      session &&
      isLegalProtectedAuthPath(pathname) &&
      !hasAcceptedCurrentLegal(session.user)
    ) {
      return legalConsentRequiredResponse()
    }
    if (session && !canUseApp(session.user)) return previewAccessRequiredResponse()
  }
  return auth.handler(requireMcpConsent(request))
}

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
})
