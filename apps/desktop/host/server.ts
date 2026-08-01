import { readConfig, type DesktopConfig } from './config.ts'
import { beginSignIn, completeSignIn, signedIn, signOut } from './auth-flow.ts'
import { hasRealtimeTarget, proxyApi, proxyRealtime } from './proxy.ts'

/**
 * The loopback server the window is pointed at.
 *
 * It answers four kinds of request: the interface itself, `/api/*` proxied on
 * to Loora with the session attached, `/desktop/*` for the few things only
 * this process can do, and the socket the editor opens for realtime.
 */

const CONTENT_TYPES: Record<string, string> = {
  css: 'text/css; charset=utf-8',
  html: 'text/html; charset=utf-8',
  ico: 'image/x-icon',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  png: 'image/png',
  svg: 'image/svg+xml',
  webmanifest: 'application/manifest+json',
  woff: 'font/woff',
  woff2: 'font/woff2',
}

function contentType(path: string) {
  return CONTENT_TYPES[path.split('.').pop()?.toLowerCase() ?? ''] ??
    'application/octet-stream'
}

async function readAsset(root: URL, path: string) {
  try {
    const file = await Deno.readFile(new URL(path, root))
    return new Response(file, {
      headers: {
        'content-type': contentType(path),
        // The build fingerprints its assets; the shell must never be stale.
        'cache-control': path === 'index.html' ? 'no-store' : 'max-age=31536000, immutable',
      },
    })
  } catch {
    return null
  }
}

/**
 * The window opens on whatever this process serves, so development hands it
 * straight over to Vite: the dev server owns the interface and proxies `/api`,
 * `/desktop`, `/callback`, and `/realtime` back here.
 */
function redirectToDevServer(url: URL, devServer: string) {
  return Response.redirect(`${devServer}${url.pathname}${url.search}`, 302)
}

/** The built interface, with every unknown path falling back to the shell. */
async function serveApp(url: URL, config: DesktopConfig) {
  if (config.devServer) return redirectToDevServer(url, config.devServer)
  const path = url.pathname.replace(/^\/+/, '')
  const asset = path ? await readAsset(config.appRoot, path) : null
  if (asset) return asset
  const shell = await readAsset(config.appRoot, 'index.html')
  if (shell) return shell
  return new Response(
    'The interface has not been built. Run `bun run build:desktop`.',
    { status: 500 },
  )
}

export function startHost() {
  const config = readConfig()
  const requested = Number(Deno.env.get('LOORA_DESKTOP_PORT') ?? 0)
  let port = Number.isInteger(requested) && requested > 0 ? requested : 0

  const server = Deno.serve(
    { hostname: '127.0.0.1', port },
    async (request) => {
      const url = new URL(request.url)

      if (url.pathname === '/realtime') return proxyRealtime(request)
      if (url.pathname.startsWith('/api/')) {
        return await proxyApi(request, { config, port })
      }
      if (url.pathname === '/callback') return await completeSignIn(request, config)

      if (url.pathname === '/desktop/session') {
        return Response.json(
          { signedIn: signedIn(), realtime: hasRealtimeTarget() },
          { headers: { 'cache-control': 'no-store' } },
        )
      }
      if (url.pathname === '/desktop/sign-in' && request.method === 'POST') {
        beginSignIn(config, port)
        return Response.json({ started: true })
      }
      if (url.pathname === '/desktop/sign-out' && request.method === 'POST') {
        await signOut(config)
        return Response.json({ signedIn: false })
      }

      return await serveApp(url, config)
    },
  )

  // Port 0 asks the operating system for a free one; this is where it lands.
  port = (server.addr as Deno.NetAddr).port

  return { server, config, port }
}
