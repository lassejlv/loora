import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from '@loora/auth/legal-consent'

const STORAGE_KEY = 'loora:pending-legal-consent'
const CURRENT_VALUE = `${CURRENT_TERMS_VERSION}:${CURRENT_PRIVACY_VERSION}`

export function markPendingLegalConsent() {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(STORAGE_KEY, CURRENT_VALUE)
}

export function hasPendingLegalConsent() {
  if (typeof window === 'undefined') return false
  return window.sessionStorage.getItem(STORAGE_KEY) === CURRENT_VALUE
}

export function clearPendingLegalConsent() {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(STORAGE_KEY)
}
