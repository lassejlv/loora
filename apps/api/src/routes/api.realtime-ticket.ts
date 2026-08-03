import { presenceColor } from '@loora/realtime/events'
import {
  REALTIME_TICKET_TTL_MS,
  signRealtimeTicket,
} from '@loora/realtime/ticket'
import {
  rateLimit,
  rateLimits,
  tooManyRequestsResponse,
} from '@loora/rpc/rate-limit'
import {
  requireRealtimeSession,
  resolveRealtimeAccessForSession,
} from './-realtime-access'

/**
 * Mints a connection ticket for the WebSocket service.
 *
 * `ws.loora.design` is its own origin, so the browser cannot send it the
 * session cookie. This endpoint runs every check the editor already runs —
 * session, legal consent, design access, preview access, plan — and hands back
 * a signed, short-lived ticket that carries the identity the room should show.
 * A 503 here is not an error: it means realtime is not configured, and the
 * client quietly falls back to the server-sent-events stream.
 */

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Minting a ticket costs a design lookup, a plan check, and a branch check, so
 * an account that asks in a loop should be turned away before any of that. One
 * socket needs a ticket every 15 minutes plus a few on reconnects; the limit
 * leaves room for a bad network without leaving room for a script.
 */
export function allowTicketRequest(userId: string) {
  return rateLimit('realtime-ticket', `user:${userId}`, rateLimits.realtimeTicket)
}

function realtimeConfig() {
  const url = process.env.REALTIME_WS_URL?.trim()
  const secret = process.env.REALTIME_TICKET_SECRET?.trim()
  if (!url || !secret) return null
  return { url: url.replace(/\/+$/, ''), secret }
}

export async function realtimeTicketResponse(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response('Invalid ticket request', { status: 400 })
  }
  if (!record(body)) {
    return new Response('Invalid ticket request', { status: 400 })
  }

  const authenticated = await requireRealtimeSession(request)
  if (!authenticated.ok) return authenticated.response
  const decision = await allowTicketRequest(authenticated.session.user.id)
  if (!decision.ok) {
    return tooManyRequestsResponse(decision, 'Too many ticket requests')
  }

  const resolved = await resolveRealtimeAccessForSession(authenticated.session, {
    designId: typeof body.designId === 'string' ? body.designId : '',
    draftId: typeof body.draftId === 'string' ? body.draftId : null,
  })
  if (!resolved.ok) return resolved.response

  const config = realtimeConfig()
  if (!config) {
    return Response.json(
      { configured: false },
      { status: 503, headers: { 'Retry-After': '300' } },
    )
  }

  const { session, ownerUserId, role, designId, draftId } = resolved.access
  // The room key is minted here rather than taken from the caller. A client
  // that chose it could claim a peer's key and overwrite — or on disconnect,
  // clear — somebody else's cursor.
  const sessionId = crypto.randomUUID()
  const issuedAt = Date.now()
  const expiresAt = issuedAt + REALTIME_TICKET_TTL_MS
  const ticket = await signRealtimeTicket(
    {
      v: 1,
      // Spent on first use by the socket service, so a ticket that leaks is
      // worth at most the one connection it was minted for.
      jti: crypto.randomUUID(),
      userId: session.user.id,
      sessionId,
      ownerUserId,
      designId,
      draftId,
      role,
      name: session.user.name || session.user.email,
      image: session.user.image ?? null,
      color: presenceColor(session.user.id),
      issuedAt,
      expiresAt,
    },
    config.secret,
  )

  return Response.json(
    { url: `${config.url}/canvas`, ticket, sessionId, expiresAt },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
