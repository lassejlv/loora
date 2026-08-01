import { startHost } from './host/server.ts'

/**
 * Loora for desktop.
 *
 * The window is a real one, and the interface behind it is the same one the
 * web serves — built by Vite from the same packages, and pointed at a loopback
 * server in this process rather than at a website. That server holds the
 * session and proxies every request on to Loora, which is why signing in
 * happens once, in a browser, and never again in the window.
 *
 * `deno desktop` opens the window on this process's HTTP server, so the server
 * has to exist before the window does.
 */

const { config, port } = startHost()

console.log(
  `[desktop] serving on 127.0.0.1:${port} → ${config.apiOrigin}` +
    (config.devServer ? ` (interface from ${config.devServer})` : ''),
)

// A native title bar on every platform. macOS can drop the opaque strip and
// keep the traffic lights (`transparentTitlebar`), but they then float over
// the top-left of the canvas — where the editor puts its own controls — and
// `Deno.BrowserWindow` exposes no drag region to reserve space with. A plain
// title bar costs 28px and covers nothing.
//
// The first construction adopts the window the runtime opened at startup.
export const mainWindow = new Deno.BrowserWindow({
  title: 'Loora',
  width: 1440,
  height: 900,
})
