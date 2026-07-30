import { describe, expect, test } from 'bun:test'
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  hasAcceptedCurrentLegal,
  isLegalProtectedAuthPath,
} from './legal-consent'

const accepted = {
  acceptedTerms: true,
  acceptedPrivacy: true,
  termsAcceptedAt: new Date('2026-07-30T00:00:00Z'),
  privacyAcceptedAt: new Date('2026-07-30T00:00:00Z'),
  termsVersion: CURRENT_TERMS_VERSION,
  privacyVersion: CURRENT_PRIVACY_VERSION,
}

describe('legal consent', () => {
  test('requires both current documents and recorded acceptance times', () => {
    expect(hasAcceptedCurrentLegal(accepted)).toBe(true)
    expect(hasAcceptedCurrentLegal({ ...accepted, acceptedTerms: false })).toBe(false)
    expect(hasAcceptedCurrentLegal({ ...accepted, acceptedPrivacy: false })).toBe(false)
    expect(hasAcceptedCurrentLegal({ ...accepted, termsAcceptedAt: null })).toBe(false)
    expect(hasAcceptedCurrentLegal({ ...accepted, privacyAcceptedAt: null })).toBe(false)
    expect(hasAcceptedCurrentLegal({ ...accepted, termsVersion: 'older' })).toBe(false)
    expect(hasAcceptedCurrentLegal({ ...accepted, privacyVersion: 'older' })).toBe(false)
  })

  test('blocks authenticated product auth routes without blocking sign in or sessions', () => {
    expect(isLegalProtectedAuthPath('/api/auth/checkout')).toBe(true)
    expect(isLegalProtectedAuthPath('/api/auth/customer/portal')).toBe(true)
    expect(isLegalProtectedAuthPath('/api/auth/mcp/authorize')).toBe(true)
    expect(isLegalProtectedAuthPath('/api/auth/sign-in/email')).toBe(false)
    expect(isLegalProtectedAuthPath('/api/auth/sign-up/email')).toBe(false)
    expect(isLegalProtectedAuthPath('/api/auth/get-session')).toBe(false)
  })
})
