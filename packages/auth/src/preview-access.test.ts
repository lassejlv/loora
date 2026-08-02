import { describe, expect, test } from 'vitest'
import {
  canUseApp,
  isPreviewAccessRequired,
  isPreviewProtectedAuthPath,
} from './preview-access'

describe('preview access', () => {
  test('is required by default and disabled explicitly', () => {
    expect(isPreviewAccessRequired(null)).toBe(true)
    expect(isPreviewAccessRequired('')).toBe(true)
    expect(isPreviewAccessRequired('true')).toBe(true)
    expect(isPreviewAccessRequired(' false ')).toBe(false)
  })

  test('allows approved users, admins, or everyone when disabled', () => {
    expect(canUseApp({}, true)).toBe(false)
    expect(canUseApp({ previewAccess: true }, true)).toBe(true)
    expect(canUseApp({ isAdmin: true }, true)).toBe(true)
    expect(canUseApp({}, false)).toBe(true)
  })

  test('puts preview approval in front of checkout and customer billing routes', () => {
    expect(isPreviewProtectedAuthPath('/api/auth/checkout')).toBe(true)
    expect(isPreviewProtectedAuthPath('/api/auth/customer/portal')).toBe(true)
    expect(isPreviewProtectedAuthPath('/api/auth/customer/state')).toBe(true)
    expect(isPreviewProtectedAuthPath('/api/auth/polar/webhooks')).toBe(false)
    expect(isPreviewProtectedAuthPath('/api/auth/sign-in/email')).toBe(false)
  })
})
