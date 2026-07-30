import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { and, eq } from 'drizzle-orm'
import { requireSession } from '@loora/auth'
import {
  canUseApp,
  previewAccessRequiredResponse,
} from '@loora/auth/preview-access'
import {
  hasAcceptedCurrentLegal,
  legalConsentRequiredResponse,
} from '@loora/auth/legal-consent'
import {
  authorizeBilling,
  subscriptionRequiredResponse,
} from '@loora/billing/billing'
import { db } from '@loora/db'
import {
  subscribeCanvasRealtimeEvents,
  type CanvasRealtimeEvent,
  type CanvasRealtimeSubscription,
} from '@loora/db/canvas-realtime'
import { design, designDraft } from '@loora/db/schema'

const encoder = new TextEncoder()
const eventHeaders = {
  'Cache-Control': 'no-cache, no-transform',
  'Content-Type': 'text/event-stream; charset=utf-8',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
  'X-Content-Type-Options': 'nosniff',
}

function eventData(event: CanvasRealtimeEvent) {
  return `event: canvas\ndata: ${JSON.stringify(event)}\n\n`
}

async function ownsTarget(
  userId: string,
  designId: string,
  draftId: string | null,
) {
  if (draftId) {
    return db
      .select({ id: designDraft.id })
      .from(designDraft)
      .where(
        and(
          eq(designDraft.id, draftId),
          eq(designDraft.designId, designId),
          eq(designDraft.userId, userId),
        ),
      )
      .limit(1)
      .then((rows) => !!rows[0])
  }
  return db
    .select({ id: design.id })
    .from(design)
    .where(and(eq(design.id, designId), eq(design.userId, userId)))
    .limit(1)
    .then((rows) => !!rows[0])
}

export async function canvasEventsResponse(request: Request) {
  const session = await requireSession(request)
  if (!session) return new Response('Unauthorized', { status: 401 })
  if (!hasAcceptedCurrentLegal(session.user)) return legalConsentRequiredResponse()
  if (!canUseApp(session.user)) return previewAccessRequiredResponse()
  if (!(await authorizeBilling(session.user)).access) {
    return subscriptionRequiredResponse()
  }

  const search = new URL(request.url).searchParams
  const designId = search.get('designId')?.trim() ?? ''
  const draftId = search.get('draftId')?.trim() || null
  if (
    designId.length === 0 ||
    designId.length > 128 ||
    (draftId !== null && draftId.length > 128)
  ) {
    return new Response('Invalid Canvas target', { status: 400 })
  }
  if (!(await ownsTarget(session.user.id, designId, draftId))) {
    return new Response('Not found', { status: 404 })
  }

  const pending: CanvasRealtimeEvent[] = []
  let streamController: ReadableStreamDefaultController<Uint8Array> | null =
    null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let subscription: CanvasRealtimeSubscription | null = null
  let cleaned = false
  let transportClosed = false

  const push = (event: CanvasRealtimeEvent) => {
    if (!streamController) {
      pending.push(event)
      return
    }
    try {
      streamController.enqueue(encoder.encode(eventData(event)))
    } catch {
      cleanup()
    }
  }
  const closeStream = () => {
    transportClosed = true
    if (!streamController) return
    try {
      streamController.close()
    } catch {
      // The browser may have already cancelled the stream.
    }
  }
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    if (heartbeat) clearInterval(heartbeat)
    request.signal.removeEventListener('abort', onAbort)
    subscription?.close()
  }
  const onAbort = () => {
    cleanup()
    closeStream()
  }

  try {
    subscription = await subscribeCanvasRealtimeEvents(
      session.user.id,
      { designId, draftId },
      push,
      () => {
        cleanup()
        closeStream()
      },
    )
  } catch {
    console.error('[canvas-realtime] Could not open event stream')
    return new Response('Realtime Canvas events are unavailable', {
      status: 503,
      headers: { 'Retry-After': '10' },
    })
  }
  if (!subscription) {
    return new Response('Realtime Canvas events are not configured', {
      status: 503,
      headers: { 'Retry-After': '30' },
    })
  }

  request.signal.addEventListener('abort', onAbort, { once: true })
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
      if (transportClosed) {
        controller.close()
        return
      }
      controller.enqueue(
        encoder.encode('retry: 5000\nevent: ready\ndata: {}\n\n'),
      )
      for (const event of pending.splice(0)) push(event)
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        } catch {
          cleanup()
        }
      }, 15_000)
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, { headers: eventHeaders })
}

export const Route = createFileRoute('/api/canvas-events')({
  server: {
    handlers: {
      GET: ({ request }) => canvasEventsResponse(request),
    },
  },
})
