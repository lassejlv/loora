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
  clientAddress,
  rateLimit,
  rateLimits,
  tooManyRequestsResponse,
  UNKNOWN_ADDRESS,
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
  // The desktop hand-off. The code is 32 random characters and lives for two
  // minutes, so guessing it is not the worry — but it is a credential being
  // exchanged, and it is counted like one.
  '/one-time-token/verify',
]

function isCredentialPath(pathname: string) {
  return CREDENTIAL_PATHS.some((path) => pathname.endsWith(path))
}

async function handle(request: Request) {
  const pathname = new URL(request.url).pathname

  // A budget of twelve attempts belongs to one address. If no proxy named the
  // caller, that budget would be shared by everyone signing in, and any one of
  // them could spend it for the rest — so an unnamed caller falls back to the
  // wide limit, which still stops a flood and cannot lock the product's users
  // out of their own accounts.
  const address = clientAddress(request.headers)
  const credential = isCredentialPath(pathname) && address !== UNKNOWN_ADDRESS
  const decision = await rateLimit(
    credential ? 'auth-credentials' : 'auth',
    `ip:${address}`,
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
