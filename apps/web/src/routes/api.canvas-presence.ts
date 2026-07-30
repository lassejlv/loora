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

const MAX_SELECTION = 64

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function coordinate(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e7
}

/**
 * A client reports only where it is, never who it is. Identity, colour and role
 * are stamped from the session here, so a peer cannot publish itself as someone
 * else or promote itself to an editor in the face pile.
 */
export async function canvasPresenceResponse(request: Request) {
  const session = await requireSession(request)
  if (!session) return new Response('Unauthorized', { status: 401 })
  if (!hasAcceptedCurrentLegal(session.user)) return legalConsentRequiredResponse()

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
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  if (
    designId.length === 0 ||
    designId.length > 128 ||
    (draftId !== null && draftId.length > 128) ||
    sessionId.length === 0 ||
    sessionId.length > 128
  ) {
    return new Response('Invalid presence payload', { status: 400 })
  }

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

  const cursor =
    record(body.cursor) && coordinate(body.cursor.x) && coordinate(body.cursor.y)
      ? { x: body.cursor.x as number, y: body.cursor.y as number }
      : null
  const selection = Array.isArray(body.selection)
    ? body.selection
        .filter(
          (id): id is string =>
            typeof id === 'string' && id.length > 0 && id.length <= 128,
        )
        .slice(0, MAX_SELECTION)
    : []

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
  return published
    ? new Response(null, { status: 204 })
    : new Response('Presence is unavailable', { status: 503 })
}

export const Route = createFileRoute('/api/canvas-presence')({
  server: {
    handlers: {
      POST: ({ request }) => canvasPresenceResponse(request),
    },
  },
})
