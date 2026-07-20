import { describe, expect, test } from 'bun:test'
import { canUseApp, isPreviewAccessRequired } from './preview-access'

describe('preview access', () => {
  test('is required by default and disabled explicitly', () => {
    expect(isPreviewAccessRequired(undefined)).toBe(true)
    expect(isPreviewAccessRequired('true')).toBe(true)
    expect(isPreviewAccessRequired(' false ')).toBe(false)
  })

  test('allows approved users, admins, or everyone when disabled', () => {
    expect(canUseApp({}, true)).toBe(false)
    expect(canUseApp({ previewAccess: true }, true)).toBe(true)
    expect(canUseApp({ isAdmin: true }, true)).toBe(true)
    expect(canUseApp({}, false)).toBe(true)
  })
})
