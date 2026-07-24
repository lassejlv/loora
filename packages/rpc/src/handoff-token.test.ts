import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createHandoffToken, readHandoffToken } from './handoff-token'

const originalSecret = process.env.BETTER_AUTH_SECRET

beforeEach(() => {
  process.env.BETTER_AUTH_SECRET = 'test-only-handoff-secret-at-least-32-bytes'
})

afterEach(() => {
  if (originalSecret == null) delete process.env.BETTER_AUTH_SECRET
  else process.env.BETTER_AUTH_SECRET = originalSecret
})

describe('handoff tokens', () => {
  it('round-trips signed design and user claims', async () => {
    const created = await createHandoffToken('design-1', 'user-1')
    const claims = await readHandoffToken(created.token)

    expect(claims?.designId).toBe('design-1')
    expect(claims?.userId).toBe('user-1')
    expect(created.expiresAt).toBeGreaterThan(Date.now())
  })

  it('binds a handoff to its draft when requested', async () => {
    const created = await createHandoffToken('design-1', 'user-1', 60, 'draft-1')
    const claims = await readHandoffToken(created.token)

    expect(claims?.designId).toBe('design-1')
    expect(claims?.draftId).toBe('draft-1')
  })

  it('rejects tampered and expired tokens', async () => {
    const current = await createHandoffToken('design-1', 'user-1')
    const expired = await createHandoffToken('design-1', 'user-1', -1)

    // Tamper the payload, not the signature tail: the final base64url char
    // only carries 2 significant bits, so many single-char edits there decode
    // to the same signature bytes. Any payload change breaks the HMAC.
    const tampered = `${current.token[0] === 'A' ? 'B' : 'A'}${current.token.slice(1)}`
    expect(await readHandoffToken(tampered)).toBeNull()
    expect(await readHandoffToken(expired.token)).toBeNull()
  })
})
