/**
 * Everything the host process needs to know before it opens a window.
 *
 * The host is the Deno half of the desktop app: it serves the interface, holds
 * the session, and proxies every call on to Loora. It runs under `deno desktop`
 * with no npm resolution, so nothing in `host/` may import a workspace package.
 */

export interface DesktopConfig {
  /** The Loora deployment this app talks to. */
  apiOrigin: string
  /**
   * A Vite dev server to pass interface requests to. Absent in a packaged app,
   * where the built interface is read from `dist/app` instead.
   */
  devServer: string | null
  /** Where the built interface lives — a URL, so it also works embedded. */
  appRoot: URL
}

function origin(value: string | undefined, fallback: string) {
  const trimmed = value?.trim()
  if (!trimmed) return fallback
  try {
    return new URL(trimmed).origin
  } catch {
    return fallback
  }
}

export function readConfig(): DesktopConfig {
  const devServer = Deno.env.get('LOORA_DESKTOP_DEV_SERVER')?.trim()
  return {
    apiOrigin: origin(Deno.env.get('LOORA_API_ORIGIN'), 'https://loora.design'),
    devServer: devServer ? origin(devServer, devServer) : null,
    appRoot: new URL('../dist/app/', import.meta.url),
  }
}

/** `Loora` on macOS and Windows, `loora` where the convention is lowercase. */
export function appDataDirectory() {
  const home = Deno.env.get('HOME') ?? ''
  if (Deno.build.os === 'darwin') return `${home}/Library/Application Support/Loora`
  if (Deno.build.os === 'windows') {
    const appData = Deno.env.get('APPDATA') ?? `${Deno.env.get('USERPROFILE') ?? ''}\\AppData\\Roaming`
    return `${appData}\\Loora`
  }
  const dataHome = Deno.env.get('XDG_DATA_HOME')?.trim()
  return `${dataHome || `${home}/.local/share`}/loora`
}
