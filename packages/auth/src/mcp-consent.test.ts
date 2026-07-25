import { describe, expect, it } from 'bun:test'
import { isMcpAuthorizePath, requireMcpConsent, withConsentPrompt } from './mcp-consent'

const authorize = (query: string) =>
  new Request(`https://loora.design/api/auth/mcp/authorize${query}`)

const promptOf = (request: Request) => new URL(request.url).searchParams.get('prompt')

describe('withConsentPrompt', () => {
  it('adds consent to an empty or missing prompt', () => {
    expect(withConsentPrompt(null)).toBe('consent')
    expect(withConsentPrompt('')).toBe('consent')
  })

  it('keeps other prompt values', () => {
    expect(withConsentPrompt('login')).toBe('login consent')
    expect(withConsentPrompt('consent')).toBe('consent')
  })

  it('overrides none, which asks for no interaction at all', () => {
    expect(withConsentPrompt('none')).toBe('consent')
  })
})

describe('requireMcpConsent', () => {
  it('forces consent when the client omits it', () => {
    const forced = requireMcpConsent(
      authorize('?client_id=abc&response_type=code&redirect_uri=http://localhost:1/cb'),
    )
    expect(promptOf(forced)).toBe('consent')
    // Everything else about the request survives the rewrite.
    const url = new URL(forced.url)
    expect(url.searchParams.get('client_id')).toBe('abc')
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:1/cb')
    expect(url.pathname).toBe('/api/auth/mcp/authorize')
  })

  it('forces consent when the client asks for silent authorization', () => {
    expect(promptOf(requireMcpConsent(authorize('?prompt=none')))).toBe('consent')
  })

  it('preserves a login prompt so the sign-in step still runs', () => {
    expect(promptOf(requireMcpConsent(authorize('?prompt=login')))).toBe('login consent')
  })

  it('passes an already-consenting request through untouched', () => {
    const request = authorize('?prompt=consent')
    expect(requireMcpConsent(request)).toBe(request)
  })

  it('leaves every other auth route alone', () => {
    const request = new Request('https://loora.design/api/auth/sign-in/email?prompt=none')
    expect(requireMcpConsent(request)).toBe(request)
    expect(isMcpAuthorizePath('/api/auth/mcp/token')).toBe(false)
  })
})
