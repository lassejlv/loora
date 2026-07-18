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

  it('rejects tampered and expired tokens', async () => {
    const current = await createHandoffToken('design-1', 'user-1')
    const expired = await createHandoffToken('design-1', 'user-1', -1)

    expect(await readHandoffToken(`${current.token.slice(0, -1)}x`)).toBeNull()
    expect(await readHandoffToken(expired.token)).toBeNull()
  })
})
