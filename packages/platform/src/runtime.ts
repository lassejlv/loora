/**
 * Where the client is running, and how it reaches Loora.
 *
 * The web app is served by the origin it calls, so every default here is "my
 * own origin" and web code behaves exactly as it did before this module
 * existed. The desktop app is served by a loopback server in its own process
 * that proxies `/api/*` on to loora.design with the session token attached —
 * so its API origin is also its own, but a link meant for a browser has to
 * point at the public app rather than at `http://127.0.0.1:<port>`.
 *
 * Nothing in here imports anything: it is the one module every layer
 * (`@loora/rpc/client`, `@loora/auth/client`, the editor) may depend on.
 */

export type LooraPlatform = 'web' | 'desktop'

export interface LooraRuntime {
  platform: LooraPlatform
  /** Origin serving `/api/*`. Empty means the document's own origin. */
  apiOrigin: string
  /** Origin a link handed to a browser points at. Empty means the document's. */
  appOrigin: string
}

let runtime: LooraRuntime = {
  platform: 'web',
  apiOrigin: '',
  appOrigin: '',
}

/**
 * Called once, before anything renders. The desktop entry point imports the
 * module that calls this ahead of the router, so the auth client picks up the
 * origins at the moment it is created.
 */
export function configureRuntime(next: Partial<LooraRuntime>) {
  runtime = { ...runtime, ...next }
}

function documentOrigin() {
  return typeof location === 'undefined' ? '' : location.origin
}

export function platform(): LooraPlatform {
  return runtime.platform
}

export function isDesktop() {
  return runtime.platform === 'desktop'
}

export function apiOrigin() {
  return runtime.apiOrigin || documentOrigin()
}

export function appOrigin() {
  return runtime.appOrigin || documentOrigin()
}

/** `/api/rpc` against whichever origin serves the API for this client. */
export function apiUrl(path: string) {
  return `${apiOrigin()}${path}`
}

/** The public URL of an in-app route, for a link that leaves the app. */
export function appUrl(path: string) {
  return `${appOrigin()}${path}`
}
