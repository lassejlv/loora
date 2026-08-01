/**
 * The few things only the host process can do.
 *
 * Everything else the app needs goes through `/api/*`, which the host proxies
 * on to Loora. These three endpoints are local: the session lives in the host,
 * so starting and ending one is its business rather than the window's.
 */

export interface HostSession {
  signedIn: boolean
  realtime: boolean
}

export async function readHostSession(): Promise<HostSession> {
  const response = await fetch('/desktop/session', { cache: 'no-store' })
  if (!response.ok) throw new Error('The desktop host is not answering')
  return (await response.json()) as HostSession
}

/** Opens loora.design in a browser; the host waits for the hand-off. */
export async function startBrowserSignIn() {
  const response = await fetch('/desktop/sign-in', { method: 'POST' })
  if (!response.ok) throw new Error('Could not open a browser')
}

export async function signOutOfHost() {
  await fetch('/desktop/sign-out', { method: 'POST' })
}
