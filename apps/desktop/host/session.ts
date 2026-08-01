import { appDataDirectory } from './config.ts'

/**
 * The session, kept by the host process rather than by the window.
 *
 * Nothing in the interface ever reads this: the proxy attaches it on the way
 * out, so a page rendered in the webview cannot hand the token to anything.
 * On disk it is one file the account owner can read and nobody else can.
 */

const FILE = 'session.json'

let cached: string | null | undefined

function path() {
  const separator = Deno.build.os === 'windows' ? '\\' : '/'
  return `${appDataDirectory()}${separator}${FILE}`
}

export function readToken(): string | null {
  if (cached !== undefined) return cached
  try {
    const parsed = JSON.parse(Deno.readTextFileSync(path())) as {
      token?: unknown
    }
    cached = typeof parsed.token === 'string' && parsed.token ? parsed.token : null
  } catch {
    cached = null
  }
  return cached
}

export function writeToken(token: string) {
  cached = token
  const directory = appDataDirectory()
  Deno.mkdirSync(directory, { recursive: true })
  Deno.writeTextFileSync(path(), JSON.stringify({ token }), { mode: 0o600 })
  // `mode` is only honoured when the file is created, and Windows ignores it
  // outright — so re-apply it where it means something.
  if (Deno.build.os !== 'windows') {
    try {
      Deno.chmodSync(path(), 0o600)
    } catch {
      // A filesystem without modes is not a reason to refuse to sign in.
    }
  }
}

export function clearToken() {
  cached = null
  try {
    Deno.removeSync(path())
  } catch {
    // Already gone.
  }
}
