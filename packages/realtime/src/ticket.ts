/**
 * Connection tickets.
 *
 * The WebSocket service is its own origin, so a browser cannot send it the
 * session cookie and cannot set an Authorization header on a WebSocket. The web
 * app — which already owns session, plan, and design-access checks — mints a
 * short-lived signed ticket instead, and the socket service only verifies the
 * signature. That keeps every access decision in one place and keeps the
 * realtime service free of the database.
 *
 * Identity travels inside the ticket. A client can therefore never publish
 * itself as somebody else, or promote itself from viewer to editor: the socket
 * service stamps presence from these claims and ignores whatever the client
 * says about who it is.
 */

export interface RealtimeTicketClaims {
  v: 1
  /**
   * Ticket id. The socket service claims it once and refuses it afterwards, so
   * a ticket that leaks — out of a proxy log, a crash dump, a shared machine —
   * is worth at most the one connection it was minted for.
   */
  jti: string
  /** Who is connecting. */
  userId: string
  /** One browser tab. Presence is keyed by it. */
  sessionId: string
  /** Whose plan the room belongs to; the channel is keyed by this. */
  ownerUserId: string
  designId: string
  draftId: string | null
  role: 'owner' | 'edit' | 'view'
  name: string
  image: string | null
  color: string
  issuedAt: number
  expiresAt: number
}

/** A ticket only has to survive the round trip from mint to connect. */
export const REALTIME_TICKET_TTL_MS = 60_000

/**
 * How long one socket may stay up on a single ticket. The service closes with
 * `4001` when it runs out and the client reconnects with a fresh one, so
 * revoked access, a closed branch, or a lapsed plan cannot hold a room open
 * indefinitely.
 */
export const REALTIME_CONNECTION_TTL_MS = 15 * 60_000

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const keys = new Map<string, Promise<CryptoKey>>()

function hmacKey(secret: string) {
  const cached = keys.get(secret)
  if (cached) return cached
  const key = crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
  keys.set(secret, key)
  return key
}

function toBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64Url(value: string) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export async function signRealtimeTicket(
  claims: RealtimeTicketClaims,
  secret: string,
) {
  const body = toBase64Url(encoder.encode(JSON.stringify(claims)))
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    encoder.encode(body),
  )
  return `${body}.${toBase64Url(new Uint8Array(signature))}`
}

function claimsFrom(value: unknown, now: number): RealtimeTicketClaims | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const claims = value as Record<string, unknown>
  const text = (field: unknown, max: number) =>
    typeof field === 'string' && field.length > 0 && field.length <= max
  if (
    claims.v !== 1 ||
    !text(claims.jti, 128) ||
    !text(claims.userId, 128) ||
    !text(claims.sessionId, 128) ||
    !text(claims.ownerUserId, 128) ||
    !text(claims.designId, 128) ||
    (claims.draftId !== null && !text(claims.draftId, 128)) ||
    (claims.role !== 'owner' && claims.role !== 'edit' && claims.role !== 'view') ||
    typeof claims.name !== 'string' ||
    claims.name.length > 200 ||
    (claims.image !== null && typeof claims.image !== 'string') ||
    typeof claims.color !== 'string' ||
    !/^#[0-9a-f]{6}$/i.test(claims.color) ||
    !Number.isFinite(claims.issuedAt) ||
    !Number.isFinite(claims.expiresAt)
  ) {
    return null
  }
  // Expiry is the point of the ticket; a clock that claims the far future is
  // as suspect as one that already lapsed.
  if (Number(claims.expiresAt) <= now) return null
  if (Number(claims.expiresAt) - now > 10 * REALTIME_TICKET_TTL_MS) return null
  return claims as unknown as RealtimeTicketClaims
}

/**
 * `secrets` may hold more than one key so a rotation has an overlap: the new
 * key signs, the old one still verifies until the tickets it signed have all
 * expired — sixty seconds — and can then be dropped.
 */
export async function verifyRealtimeTicket(
  token: string,
  secrets: string | string[],
  now = Date.now(),
): Promise<RealtimeTicketClaims | null> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 4_096) {
    return null
  }
  const separator = token.indexOf('.')
  if (separator <= 0 || separator === token.length - 1) return null
  const body = token.slice(0, separator)
  const signature = token.slice(separator + 1)
  let valid = false
  for (const secret of typeof secrets === 'string' ? [secrets] : secrets) {
    try {
      valid = await crypto.subtle.verify(
        'HMAC',
        await hmacKey(secret),
        fromBase64Url(signature),
        encoder.encode(body),
      )
    } catch {
      return null
    }
    if (valid) break
  }
  if (!valid) return null
  try {
    return claimsFrom(JSON.parse(decoder.decode(fromBase64Url(body))), now)
  } catch {
    return null
  }
}
