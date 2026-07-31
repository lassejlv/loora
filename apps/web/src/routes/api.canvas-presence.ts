import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { requireSession } from '@loora/auth'
import {
  hasAcceptedCurrentLegal,
  legalConsentRequiredResponse,
} from '@loora/auth/legal-consent'
import {
  clearCanvasPresence,
  presenceColor,
  publishCanvasPresence,
} from '@loora/db/canvas-realtime'
import { resolveDesignAccess } from '@loora/db/design-access'
import {
  normalizePresenceInput,
  scopePresenceSessionId,
} from '@loora/realtime/events'
import {
  rateLimit,
  rateLimits,
  tooManyRequestsResponse,
} from '@loora/rpc/rate-limit'

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * The fallback presence path, used only when a client cannot hold a socket.
 *
 * A client reports only where it is, never who it is. Identity, colour and role
 * are stamped from the session here, so a peer cannot publish itself as someone
 * else or promote itself to an editor in the face pile — and the key it
 * occupies in the room is scoped to the account, so one person can only ever
 * overwrite their own tabs.
 */
export async function canvasPresenceResponse(request: Request) {
  const session = await requireSession(request)
  if (!session) return new Response('Unauthorized', { status: 401 })
  if (!hasAcceptedCurrentLegal(session.user)) return legalConsentRequiredResponse()

  // Presence is decoration: a dropped frame costs a stale cursor, so the
  // ceiling can sit well above what a pointer that never stops sends.
  const decision = await rateLimit(
    'canvas-presence',
    `user:${session.user.id}`,
    rateLimits.canvasPresence,
  )
  if (!decision.ok) return tooManyRequestsResponse(decision, 'Too much presence traffic')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response('Invalid presence payload', { status: 400 })
  }
  if (!record(body)) return new Response('Invalid presence payload', { status: 400 })

  const designId = typeof body.designId === 'string' ? body.designId.trim() : ''
  const draftId =
    typeof body.draftId === 'string' && body.draftId.trim()
      ? body.draftId.trim()
      : null
  const clientId = typeof body.sessionId === 'string' ? body.sessionId : ''
  if (
    designId.length === 0 ||
    designId.length > 128 ||
    (draftId !== null && draftId.length > 128) ||
    clientId.length === 0 ||
    clientId.length > 128
  ) {
    return new Response('Invalid presence payload', { status: 400 })
  }
  const sessionId = scopePresenceSessionId(session.user.id, clientId)

  const access = await resolveDesignAccess(designId, {
    id: session.user.id,
    email: session.user.email,
  })
  if (!access) return new Response('Not found', { status: 404 })

  const target = { designId, draftId }
  if (body.leaving === true) {
    await clearCanvasPresence(access.ownerUserId, target, sessionId)
    return new Response(null, { status: 204 })
  }

  const { cursor, selection } = normalizePresenceInput(body) ?? {
    cursor: null,
    selection: [],
  }

  const published = await publishCanvasPresence(access.ownerUserId, target, {
    sessionId,
    userId: session.user.id,
    name: session.user.name || session.user.email,
    image: session.user.image ?? null,
    color: presenceColor(session.user.id),
    role: access.role,
    cursor,
    selection,
    updatedAt: Date.now(),
  })
  // The caller is told which key it ended up under so it can recognise its own
  // frames coming back through the event stream.
  return published
    ? Response.json({ sessionId }, { headers: { 'Cache-Control': 'no-store' } })
    : new Response('Presence is unavailable', { status: 503 })
}

export const Route = createFileRoute('/api/canvas-presence')({
  server: {
    handlers: {
      POST: ({ request }) => canvasPresenceResponse(request),
    },
  },
})
