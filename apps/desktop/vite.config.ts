import { defineConfig, type Plugin } from 'vite'
import { readFile } from 'node:fs/promises'
import { cp } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

const hostPort = process.env.LOORA_DESKTOP_PORT ?? '4300'
const appPort = process.env.LOORA_DESKTOP_APP_PORT ?? '1421'
const host = `http://127.0.0.1:${hostPort}`

/** The web app owns the self-hosted fonts; this serves the same files. */
const fontsDirectory = fileURLToPath(new URL('../web/public/vendor/', import.meta.url))

function vendorFonts(): Plugin {
  return {
    name: 'loora:vendor-fonts',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const path = request.url?.split('?')[0]
        if (!path?.startsWith('/vendor/')) return next()
        try {
          const file = await readFile(fontsDirectory + path.slice('/vendor/'.length))
          response.setHeader(
            'content-type',
            path.endsWith('.css') ? 'text/css; charset=utf-8' : 'font/woff2',
          )
          response.end(file)
        } catch {
          next()
        }
      })
    },
    async closeBundle() {
      await cp(fontsDirectory, fileURLToPath(new URL('./dist/app/vendor/', import.meta.url)), {
        recursive: true,
      })
    },
  }
}

export default defineConfig({
  clearScreen: false,
  resolve: { tsconfigPaths: true },
  plugins: [
    vendorFonts(),
    tailwindcss(),
    tanstackRouter({ target: 'react', quoteStyle: 'single', autoCodeSplitting: true }),
    viteReact(),
  ],
  build: {
    outDir: 'dist/app',
    emptyOutDir: true,
    // The window loads from a loopback server, never from a CDN, so a source
    // map costs nothing to ship and makes a stack trace readable.
    sourcemap: true,
  },
  server: {
    host: '127.0.0.1',
    port: Number(appPort),
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
    // The Tauri window stays on the Rust host (:4300) and reverse-proxies this
    // server. HMR still talks to Vite directly so the host does not have to
    // bridge websockets.
    hmr: {
      protocol: 'ws',
      host: '127.0.0.1',
      port: Number(appPort),
    },
    // Kept for opening the interface in a regular browser during development.
    proxy: {
      '/api': { target: host, changeOrigin: false },
      '/desktop': { target: host, changeOrigin: false },
      '/callback': { target: host, changeOrigin: false },
      '/realtime': { target: host, ws: true, changeOrigin: false },
    },
  },
})
