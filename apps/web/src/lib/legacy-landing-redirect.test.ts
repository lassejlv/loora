import { describe, expect, test } from 'bun:test'
import { resolveLegacyLandingRedirect } from './legacy-landing-redirect'

describe('resolveLegacyLandingRedirect', () => {
  test('renders the landing page when there is nothing legacy to resolve', () => {
    expect(resolveLegacyLandingRedirect({})).toBeNull()
    expect(resolveLegacyLandingRedirect(undefined)).toBeNull()
    expect(resolveLegacyLandingRedirect({ settings: 'account' })).toBeNull()
    expect(resolveLegacyLandingRedirect({ design: 42 })).toBeNull()
  })

  test('sends ?design= and ?d= to the canonical editor route', () => {
    expect(resolveLegacyLandingRedirect({ design: 'doc1' })).toEqual({
      to: '/design/$id',
      id: 'doc1',
    })
    expect(resolveLegacyLandingRedirect({ d: 'doc2' })).toEqual({
      to: '/design/$id',
      id: 'doc2',
    })
  })

  test('maps ?draft= onto the branch route', () => {
    expect(resolveLegacyLandingRedirect({ design: 'doc1', draft: 'br1' })).toEqual({
      to: '/design/$id/b/$branchId',
      id: 'doc1',
      branchId: 'br1',
    })
  })

  test('prefers the document over legacy settings params', () => {
    expect(resolveLegacyLandingRedirect({ d: 'doc1', settings: 'billing' })).toEqual({
      to: '/design/$id',
      id: 'doc1',
    })
  })

  test('resolves the legacy settings screens', () => {
    expect(resolveLegacyLandingRedirect({ settings: 'billing' })).toEqual({ to: '/app/billing' })
    expect(resolveLegacyLandingRedirect({ settings: 'github' })).toEqual({
      to: '/app/integrations',
      integration: 'github',
    })
    expect(resolveLegacyLandingRedirect({ settings: 'mcp' })).toEqual({
      to: '/app/integrations',
      integration: 'mcp',
    })
    expect(resolveLegacyLandingRedirect({ settings: 'integrations' })).toEqual({
      to: '/app/integrations',
      integration: null,
    })
    expect(
      resolveLegacyLandingRedirect({ settings: 'integrations', integration: 'github' }),
    ).toEqual({ to: '/app/integrations', integration: 'github' })
  })

  test('drops an unknown integration tab instead of forwarding it', () => {
    expect(
      resolveLegacyLandingRedirect({ settings: 'integrations', integration: 'slack' }),
    ).toEqual({ to: '/app/integrations', integration: null })
  })
})
