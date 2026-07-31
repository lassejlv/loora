import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import {
  readCanvasAgentActivity,
  readCanvasPresence,
  subscribeCanvasRealtimeEvents,
  type CanvasRealtimeEvent,
  type CanvasRealtimeSubscription,
} from '@loora/db/canvas-realtime'
import {
  rateLimit,
  rateLimits,
  tooManyRequestsResponse,
} from '@loora/rpc/rate-limit'
import {
  requireRealtimeSession,
  resolveRealtimeAccessForSession,
} from './-realtime-access'

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

export async function canvasEventsResponse(request: Request) {
  const search = new URL(request.url).searchParams
  const authenticated = await requireRealtimeSession(request)
  if (!authenticated.ok) return authenticated.response
  // Counted before the design lookup: a client reconnecting in a loop should
  // cost this instance a counter increment, not a round of access checks and
  // a subscription.
  const decision = await rateLimit(
    'canvas-events',
    `user:${authenticated.session.user.id}`,
    rateLimits.canvasEvents,
  )
  if (!decision.ok) {
    return tooManyRequestsResponse(decision, 'Too many event stream connections')
  }
  const resolved = await resolveRealtimeAccessForSession(authenticated.session, {
    designId: search.get('designId') ?? '',
    draftId: search.get('draftId'),
  })
  if (!resolved.ok) return resolved.response
  const { ownerUserId, designId, draftId } = resolved.access

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
      ownerUserId,
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
      // Whoever is already in the room, so a late arrival sees them without
      // waiting for each of them to move.
      void readCanvasPresence(ownerUserId, { designId, draftId })
        .then((peers) => {
          if (peers.length > 0) {
            push({ type: 'presence.state', peers, sentAt: Date.now() })
          }
        })
        .catch(() => undefined)
      // Same for an agent that is already mid-run: the tab shows it now rather
      // than at its next tool call.
      void readCanvasAgentActivity(ownerUserId, { designId, draftId })
        .then((activity) => {
          if (activity) {
            push({ type: 'agent.activity', activity, sentAt: Date.now() })
          }
        })
        .catch(() => undefined)
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
