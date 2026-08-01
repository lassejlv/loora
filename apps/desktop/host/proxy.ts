import type { DesktopConfig } from './config.ts'
import { clearToken, readToken, writeToken } from './session.ts'

/**
 * The window talks to this process and nothing else.
 *
 * Every `/api/*` call is forwarded to Loora with the session attached here, so
 * the interface stays on one origin: images served from `/api/asset/…`, the
 * event stream, and the RPC endpoint all behave exactly as they do on the web,
 * and no page in the webview ever holds a credential.
 */

/** Offered alongside the ticket, and echoed back — matches the editor. */
const REALTIME_PROTOCOL = 'loora.realtime.v1'

/** Set by the proxy from the last ticket, so a socket has somewhere to go. */
let realtimeUpstream: string | null = null

export interface ProxyContext {
  config: DesktopConfig
  /** The loopback port this host is serving on. */
  port: number
}

/** Headers that describe the hop, not the request. */
const HOP_BY_HOP = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

function forwardHeaders(request: Request, config: DesktopConfig) {
  const headers = new Headers()
  for (const [name, value] of request.headers) {
    if (HOP_BY_HOP.has(name.toLowerCase())) continue
    if (name.toLowerCase() === 'cookie') continue
    headers.set(name, value)
  }
  // Better Auth checks the origin of anything that changes state, and it is
  // this process — not the window — that is the caller it should recognise.
  headers.set('origin', config.apiOrigin)
  headers.set('referer', `${config.apiOrigin}/`)
  const token = readToken()
  if (token) headers.set('authorization', `Bearer ${token}`)
  return headers
}

export function openExternal(url: string) {
  const command =
    Deno.build.os === 'darwin'
      ? { bin: 'open', args: [url] }
      : Deno.build.os === 'windows'
        ? { bin: 'cmd', args: ['/c', 'start', '', url] }
        : { bin: 'xdg-open', args: [url] }
  try {
    new Deno.Command(command.bin, { args: command.args }).spawn()
  } catch (error) {
    console.error('[desktop] could not open a browser:', error)
  }
}

/**
 * The realtime ticket names the socket service directly. A browser would
 * connect there itself; this window connects back to the host instead, which
 * holds the outbound socket — so the service only ever sees Loora's own
 * origins, and the app needs no configuration on that side.
 */
async function rewriteTicket(response: Response, context: ProxyContext) {
  const ticket = (await response.json()) as { url?: unknown }
  if (typeof ticket.url === 'string') {
    realtimeUpstream = ticket.url
    ticket.url = `ws://127.0.0.1:${context.port}/realtime`
  }
  return Response.json(ticket, {
    status: response.status,
    headers: { 'cache-control': 'no-store' },
  })
}

export async function proxyApi(request: Request, context: ProxyContext) {
  const url = new URL(request.url)
  const target = new URL(
    `${url.pathname}${url.search}`,
    context.config.apiOrigin,
  )

  let response: Response
  try {
    response = await fetch(target, {
      method: request.method,
      headers: forwardHeaders(request, context.config),
      body: request.method === 'GET' || request.method === 'HEAD' ? null : request.body,
      redirect: 'manual',
    })
  } catch (error) {
    console.error('[desktop] proxy failed:', error)
    return new Response('Loora is unreachable', { status: 502 })
  }

  // A refreshed session arrives as a header rather than a cookie, because the
  // bearer plugin on the server answers this process the way it answers any
  // client without a cookie jar.
  const refreshed = response.headers.get('set-auth-token')
  if (refreshed) writeToken(refreshed)
  if (url.pathname === '/api/auth/sign-out' && response.ok) clearToken()

  // Checkout, the billing portal, and OAuth consent belong in a real browser:
  // they are somebody else's pages, and some of them refuse a webview.
  const location = response.headers.get('location')
  if (location) {
    const destination = new URL(location, context.config.apiOrigin)
    if (destination.origin !== context.config.apiOrigin) {
      openExternal(destination.toString())
      return Response.json({ openedExternally: destination.toString() })
    }
    const headers = new Headers(response.headers)
    headers.set('location', `${destination.pathname}${destination.search}`)
    headers.delete('set-cookie')
    return new Response(null, { status: response.status, headers })
  }

  if (url.pathname === '/api/realtime-ticket' && response.ok) {
    return await rewriteTicket(response, context)
  }

  const headers = new Headers(response.headers)
  // The window has no cookie jar to put these in, and the session it would
  // carry lives in this process already.
  headers.delete('set-cookie')
  headers.delete('set-auth-token')
  return new Response(response.body, { status: response.status, headers })
}

/** True once a ticket has named where the socket service is. */
export function hasRealtimeTarget() {
  return realtimeUpstream !== null
}

export function proxyRealtime(request: Request) {
  const upstream = realtimeUpstream
  if (!upstream) return new Response('No realtime target yet', { status: 503 })

  const offered = (request.headers.get('sec-websocket-protocol') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (!offered.includes(REALTIME_PROTOCOL)) {
    return new Response('Expected the Loora realtime protocol', { status: 400 })
  }

  let upgrade: Deno.WebSocketUpgrade
  try {
    upgrade = Deno.upgradeWebSocket(request, { protocol: REALTIME_PROTOCOL })
  } catch {
    return new Response('Expected a WebSocket upgrade', { status: 426 })
  }

  const { socket: client, response } = upgrade
  const server = new WebSocket(upstream, offered)
  const pending: string[] = []

  const close = (target: WebSocket, code: number, reason: string) => {
    // 1005 and 1006 are what a socket reports, not what it may send on.
    const safe = code >= 3000 && code <= 4999 ? code : 1000
    try {
      target.close(safe, reason.slice(0, 123))
    } catch {
      // Already closing.
    }
  }

  server.addEventListener('open', () => {
    for (const message of pending.splice(0)) server.send(message)
  })
  server.addEventListener('message', (event) => {
    if (typeof event.data === 'string' && client.readyState === WebSocket.OPEN) {
      client.send(event.data)
    }
  })
  server.addEventListener('close', (event) => close(client, event.code, event.reason))
  server.addEventListener('error', () => close(client, 1000, 'upstream error'))

  client.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return
    if (server.readyState === WebSocket.OPEN) server.send(event.data)
    else if (server.readyState === WebSocket.CONNECTING) pending.push(event.data)
  })
  client.addEventListener('close', (event) => close(server, event.code, event.reason))
  client.addEventListener('error', () => close(server, 1000, 'window error'))

  return response
}
