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
import {
  callerIdentity,
  rateLimit,
  rateLimits,
  tooManyRequestsResponse,
} from '@loora/rpc/rate-limit'

/**
 * The credential endpoints, where a wrong answer is worth trying again. They
 * are counted per address on a much tighter budget than the rest of the auth
 * surface, which is mostly session reads the app makes on every page.
 */
const CREDENTIAL_PATHS = [
  '/sign-in/email',
  '/sign-in/username',
  '/sign-up/email',
  '/forget-password',
  '/reset-password',
  '/change-password',
  '/change-email',
  '/send-verification-email',
  '/two-factor/verify-totp',
  '/two-factor/verify-otp',
  '/email-otp/send-verification-otp',
  '/email-otp/verify-email',
]

function isCredentialPath(pathname: string) {
  return CREDENTIAL_PATHS.some((path) => pathname.endsWith(path))
}

async function handle(request: Request) {
  const pathname = new URL(request.url).pathname

  const credential = isCredentialPath(pathname)
  const decision = await rateLimit(
    credential ? 'auth-credentials' : 'auth',
    callerIdentity(request.headers),
    credential ? rateLimits.authSensitive : rateLimits.auth,
  )
  if (!decision.ok) {
    return tooManyRequestsResponse(
      decision,
      'Too many attempts. Wait a moment and try again.',
    )
  }

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
