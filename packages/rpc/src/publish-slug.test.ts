import { describe, expect, it } from 'vitest'
import {
  assertHandle,
  isValidHandle,
  isValidSlug,
  newPublishSiteId,
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

  it('mints a random public site id', () => {
    const first = newPublishSiteId()
    const second = newPublishSiteId()
    expect(first).toMatch(/^[0-9a-f]{32}$/)
    expect(second).toMatch(/^[0-9a-f]{32}$/)
    expect(first).not.toBe(second)
    expect(isValidSlug(first)).toBe(true)
  })

  it('builds storage keys and public paths', () => {
    const id = 'a'.repeat(32)
    expect(siteStorageKey('lasse', id)).toBe(`sites/lasse/${id}/index.html`)
    expect(sitePublicPath('lasse', id)).toBe(`/sites/lasse/${id}`)
  })
})
