/**
 * Where the client is running, and how it reaches Loora.
 *
 * Defaults use the document's own origin. The desktop app is served by a
 * loopback server in its own process that proxies `/api/*` with the session
 * token attached, so its API origin remains its own; only links meant for a
 * browser point at the public app instead of `http://127.0.0.1:<port>`.
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
  /**
   * Follows a link that belongs somewhere else — a checkout, an OAuth consent
   * screen. A browser tab simply goes there; a desktop window must not, so it
   * hands the URL to the process that can open a browser.
   */
  openExternal: (url: string) => void
}

let runtime: LooraRuntime = {
  platform: 'web',
  apiOrigin: '',
  appOrigin: '',
  openExternal: (url) => window.location.assign(url),
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

/** Opens a URL that is not part of this app, wherever it belongs. */
export function openExternal(url: string) {
  runtime.openExternal(url)
}

/** The public URL of an in-app route, for a link that leaves the app. */
export function appUrl(path: string) {
  return `${appOrigin()}${path}`
}
