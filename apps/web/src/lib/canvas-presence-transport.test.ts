import { afterEach, describe, expect, mock, test } from 'bun:test'
import { createCanvasDocument } from '@loora/canvas/model'

mock.module('#/lib/orpc-client', () => ({
  orpc: {
    canvas: {
      get: mock(async () => ({ document: createCanvasDocument('Test', 'test'), revision: 0 })),
      apply: mock(async () => ({ revision: 0, transactionIds: [] })),
    },
  },
}))

const { CanvasSyncController } = await import('./canvas-client')

interface FetchCall {
  url: string
  body: unknown
}

/**
 * Presence must ride one transport at a time. Before the socket exists the
 * client used to post the same peer to `/api/canvas-presence`, so the room saw
 * every cursor twice — once over HTTP and once over the socket.
 */
function stubFetch(ticket: (() => Promise<Response>) | null) {
  const calls: FetchCall[] = []
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    let body: unknown = null
    try {
      body = init?.body ? JSON.parse(String(init.body)) : null
    } catch {
      body = init?.body ?? null
    }
    calls.push({ url, body })
    if (url.includes('/api/realtime-ticket')) {
      // No ticket source means "stay pending forever" for this test.
      return ticket ? ticket() : new Promise<Response>(() => {})
    }
    return new Response(null, { status: 204 })
  }) as typeof fetch
  return calls
}

const originalFetch = globalThis.fetch

async function openController() {
  const controller = await CanvasSyncController.open(
    { designId: 'design-1', draftId: null },
    createCanvasDocument('Test', 'test'),
    0,
  )
  // Let the presence heartbeat's first send and the ticket request settle.
  await new Promise((resolve) => setTimeout(resolve, 20))
  return controller
}

describe('presence transport', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('posts nothing over HTTP while the socket is still being ticketed', async () => {
    const calls = stubFetch(null)

    const controller = await openController()
    controller.publishPresence({ cursor: { x: 12, y: 20 }, selection: ['hero'] })
    await new Promise((resolve) => setTimeout(resolve, 120))

    expect(calls.some((call) => call.url.includes('/api/realtime-ticket'))).toBe(true)
    expect(calls.some((call) => call.url.includes('/api/canvas-presence'))).toBe(false)
    await controller.close()
  })

  test('falls back to posting presence when realtime is not configured', async () => {
    const calls = stubFetch(
      async () => new Response(JSON.stringify({ configured: false }), { status: 503 }),
    )

    const controller = await openController()
    controller.publishPresence({ cursor: { x: 4, y: 8 }, selection: [] })
    await new Promise((resolve) => setTimeout(resolve, 120))

    const presence = calls.filter((call) => call.url.includes('/api/canvas-presence'))
    expect(presence.length).toBeGreaterThan(0)
    expect(presence.at(-1)?.body).toMatchObject({
      designId: 'design-1',
      cursor: { x: 4, y: 8 },
    })
    await controller.close()
  })
})
