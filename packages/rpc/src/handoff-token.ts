import { Buffer } from 'node:buffer'

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60

interface HandoffClaims {
  designId: string
  draftId?: string
  userId: string
  expiresAt: number
  nonce: string
}

function secret() {
  const value = process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET
  if (!value || value.length < 16) throw new Error('BETTER_AUTH_SECRET is required for handoffs')
  return value
}

async function key() {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function createHandoffToken(
  designId: string,
  userId: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  draftId?: string | null,
) {
  const claims: HandoffClaims = {
    designId,
    ...(draftId ? { draftId } : {}),
    userId,
    expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
    nonce: crypto.randomUUID(),
  }
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const signature = await crypto.subtle.sign('HMAC', await key(), new TextEncoder().encode(payload))
  return {
    token: `${payload}.${Buffer.from(signature).toString('base64url')}`,
    expiresAt: claims.expiresAt * 1000,
  }
}

export async function readHandoffToken(token: string): Promise<HandoffClaims | null> {
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra || token.length > 2_000) return null

  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await key(),
      Buffer.from(signature, 'base64url'),
      new TextEncoder().encode(payload),
    )
    if (!valid) return null

    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as HandoffClaims
    if (
      typeof claims.designId !== 'string' ||
      typeof claims.userId !== 'string' ||
      typeof claims.expiresAt !== 'number' ||
      typeof claims.nonce !== 'string' ||
      (claims.draftId !== undefined &&
        (typeof claims.draftId !== 'string' ||
          claims.draftId.length === 0 ||
          claims.draftId.length > 128)) ||
      claims.designId.length > 128 ||
      claims.userId.length > 128 ||
      claims.expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      return null
    }
    return claims
  } catch {
    return null
  }
}
