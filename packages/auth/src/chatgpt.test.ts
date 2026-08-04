import { describe, expect, it } from 'vitest'
import { readIdTokenClaims, safeReturnTo } from './chatgpt'

function idToken(claims: Record<string, unknown>) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'RS256' })}.${encode(claims)}.signature`
}

describe('readIdTokenClaims', () => {
  it('reads the subject that binds a ChatGPT account to a Loora user', () => {
    const claims = readIdTokenClaims(
      idToken({
        sub: 'user_abc',
        email: 'someone@example.com',
        name: 'Someone',
        picture: 'https://example.com/a.png',
        'https://api.openai.com/auth': {
          chatgpt_account_id: 'acct_1',
          chatgpt_plan_type: 'plus',
        },
      }),
    )
    expect(claims).toEqual({
      subject: 'user_abc',
      accountId: 'acct_1',
      email: 'someone@example.com',
      name: 'Someone',
      avatarUrl: 'https://example.com/a.png',
      planType: 'plus',
    })
  })

  it('is happy with an identity that carries nothing but a subject', () => {
    expect(readIdTokenClaims(idToken({ sub: 'user_abc' }))).toEqual({
      subject: 'user_abc',
      accountId: null,
      email: null,
      name: null,
      avatarUrl: null,
      planType: null,
    })
  })

  it('refuses a token with no subject to bind to', () => {
    expect(readIdTokenClaims(idToken({ email: 'a@b.c' }))).toBeNull()
  })

  it('refuses anything that is not a token', () => {
    expect(readIdTokenClaims('nonsense')).toBeNull()
    expect(readIdTokenClaims('')).toBeNull()
    expect(readIdTokenClaims('a.!!!.c')).toBeNull()
  })

  it('drops claims that are the wrong type or absurdly long', () => {
    const claims = readIdTokenClaims(
      idToken({
        sub: 'user_abc',
        email: 42,
        name: 'x'.repeat(600),
      }),
    )
    expect(claims?.email).toBeNull()
    expect(claims?.name).toBeNull()
  })
})

describe('safeReturnTo', () => {
  it('keeps a same-origin path', () => {
    expect(safeReturnTo('/design/abc?width=1440')).toBe('/design/abc?width=1440')
  })

  it('refuses to bounce somebody off this origin', () => {
    expect(safeReturnTo('https://evil.example.com')).toBe('/app/integrations')
    expect(safeReturnTo('//evil.example.com')).toBe('/app/integrations')
    expect(safeReturnTo('javascript:alert(1)')).toBe('/app/integrations')
  })

  it('falls back when nothing was asked for', () => {
    expect(safeReturnTo(null)).toBe('/app/integrations')
    expect(safeReturnTo(undefined)).toBe('/app/integrations')
    expect(safeReturnTo('')).toBe('/app/integrations')
  })
})
