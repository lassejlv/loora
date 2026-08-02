import { describe, expect, it } from 'vitest'
import {
  assertHandle,
  assertSlug,
  isValidHandle,
  isValidSlug,
  normalizeSlug,
  RESERVED_HANDLES,
  sitePublicPath,
  siteStorageKey,
} from './publish-slug'

describe('publish slug helpers', () => {
  it('accepts a normal handle and rejects reserved names', () => {
    expect(isValidHandle('lasse')).toBe(true)
    expect(isValidHandle('loora')).toBe(false)
    expect(RESERVED_HANDLES.has('sites')).toBe(true)
    expect(() => assertHandle('ab')).toThrow(/3–32/)
  })

  it('slugifies page titles', () => {
    expect(normalizeSlug('Hello World!')).toBe('hello-world')
    expect(assertSlug('Pricing Page')).toBe('pricing-page')
    expect(isValidSlug('---')).toBe(false)
  })

  it('builds storage keys and public paths', () => {
    expect(siteStorageKey('lasse', 'home')).toBe('sites/lasse/home/index.html')
    expect(sitePublicPath('lasse', 'home')).toBe('/sites/lasse/home')
  })
})
