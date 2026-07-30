import { describe, expect, it } from 'bun:test'
import { allows, canEdit, isEmail, normalizeEmail } from './design-access'

describe('design access roles', () => {
  it('orders roles so an owner can do anything an editor can', () => {
    expect(allows('owner', 'edit')).toBe(true)
    expect(allows('owner', 'view')).toBe(true)
    expect(allows('edit', 'view')).toBe(true)
    expect(allows('edit', 'edit')).toBe(true)
    expect(allows('view', 'view')).toBe(true)
  })

  it('never lets a viewer write or a collaborator take ownership', () => {
    expect(allows('view', 'edit')).toBe(false)
    expect(allows('view', 'owner')).toBe(false)
    expect(allows('edit', 'owner')).toBe(false)
    expect(canEdit('view')).toBe(false)
    expect(canEdit('edit')).toBe(true)
  })

  it('treats an invited address as an identifier, not display text', () => {
    expect(normalizeEmail('  Lasse@Example.COM ')).toBe('lasse@example.com')
    expect(isEmail('lasse@example.com')).toBe(true)
    expect(isEmail(' Lasse@Example.com ')).toBe(true)
  })

  it('rejects addresses that cannot receive an invitation', () => {
    expect(isEmail('lasse')).toBe(false)
    expect(isEmail('lasse@example')).toBe(false)
    expect(isEmail('lasse @example.com')).toBe(false)
    expect(isEmail('@example.com')).toBe(false)
    expect(isEmail(`${'a'.repeat(320)}@example.com`)).toBe(false)
  })
})
