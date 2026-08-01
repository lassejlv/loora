import type { DesktopConfig } from './config.ts'
import { openExternal } from './proxy.ts'
import { clearToken, readToken, writeToken } from './session.ts'

/**
 * Signing in happens at loora.design, in a real browser.
 *
 * The app opens that page with the port it is listening on and a state string
 * only it knows. The page mints a single-use code from the session the visitor
 * signed into, and sends it back here — once, to loopback. This process trades
 * the code for the session, and the window is told nothing except that it
 * worked.
 */

let pendingState: string | null = null

function randomState() {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function beginSignIn(config: DesktopConfig, port: number) {
  pendingState = randomState()
  const url = new URL('/desktop/auth', config.apiOrigin)
  url.searchParams.set('port', String(port))
  url.searchParams.set('state', pendingState)
  openExternal(url.toString())
}

function page(title: string, message: string) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8" />` +
      `<title>${title}</title><style>` +
      `html,body{margin:0;height:100%;display:grid;place-items:center;` +
      `background:#09090b;color:#fafafa;font:14px/1.5 ui-sans-serif,system-ui}` +
      `p{max-width:34ch;text-align:center}</style></head>` +
      `<body><p>${message}</p></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  )
}

export async function completeSignIn(request: Request, config: DesktopConfig) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')
  const state = url.searchParams.get('state')
  if (!pendingState || !state || state !== pendingState || !token) {
    return page('Loora', 'That sign-in link is not one this app asked for.')
  }
  pendingState = null

  let response: Response
  try {
    response = await fetch(new URL('/api/auth/one-time-token/verify', config.apiOrigin), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: config.apiOrigin,
      },
      body: JSON.stringify({ token }),
    })
  } catch {
    return page('Loora', 'Could not reach Loora. Check your connection and try again.')
  }

  const session = response.headers.get('set-auth-token')
  if (!response.ok || !session) {
    return page('Loora', 'That sign-in code had expired. Try signing in again.')
  }
  writeToken(session)
  return page('Loora', 'Signed in. You can close this window and go back to Loora.')
}

export function signedIn() {
  return readToken() !== null
}

/** Ends the session on the server as well, so the token cannot be reused. */
export async function signOut(config: DesktopConfig) {
  const token = readToken()
  if (token) {
    try {
      await fetch(new URL('/api/auth/sign-out', config.apiOrigin), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          origin: config.apiOrigin,
          'content-type': 'application/json',
        },
        body: '{}',
      })
    } catch {
      // Signing out locally still matters when the network is down.
    }
  }
  clearToken()
}
