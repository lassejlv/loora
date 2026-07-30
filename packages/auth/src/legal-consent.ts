export const CURRENT_TERMS_VERSION = '2026-07-24'
export const CURRENT_PRIVACY_VERSION = '2026-07-24'

export interface LegalConsentFields {
  acceptedTerms?: boolean | null
  acceptedPrivacy?: boolean | null
  termsAcceptedAt?: Date | string | null
  privacyAcceptedAt?: Date | string | null
  termsVersion?: string | null
  privacyVersion?: string | null
}

export function hasAcceptedCurrentLegal(user: LegalConsentFields) {
  return (
    user.acceptedTerms === true &&
    user.acceptedPrivacy === true &&
    Boolean(user.termsAcceptedAt) &&
    Boolean(user.privacyAcceptedAt) &&
    user.termsVersion === CURRENT_TERMS_VERSION &&
    user.privacyVersion === CURRENT_PRIVACY_VERSION
  )
}

export function legalConsentRequiredResponse() {
  return Response.json(
    {
      error: 'The current Terms of Service and Privacy Policy must be accepted.',
      code: 'LEGAL_CONSENT_REQUIRED',
    },
    { status: 403 },
  )
}

export function isLegalProtectedAuthPath(pathname: string) {
  return (
    pathname === '/api/auth/checkout' ||
    pathname.startsWith('/api/auth/customer/') ||
    pathname.startsWith('/api/auth/mcp/authorize')
  )
}
