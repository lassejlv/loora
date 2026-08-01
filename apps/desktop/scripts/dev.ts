/**
 * Development runs two processes: Vite serves the interface, and the Deno host
 * serves the API proxy and opens the window. The window lands on Vite — which
 * proxies `/api`, `/desktop`, `/callback`, and `/realtime` back to the host —
 * so the app behaves in development exactly as it does packaged.
 */

const HOST_PORT = process.env.LOORA_DESKTOP_PORT ?? '4300'
const APP_PORT = process.env.LOORA_DESKTOP_APP_PORT ?? '1421'
const devServer = `http://localhost:${APP_PORT}`

const vite = Bun.spawn(
  ['bun', 'run', 'vite', 'dev', '--port', APP_PORT, '--strictPort'],
  {
    cwd: import.meta.dir + '/..',
    env: { ...process.env, LOORA_DESKTOP_PORT: HOST_PORT },
    stdio: ['inherit', 'inherit', 'inherit'],
  },
)

/** The window opens on whatever Vite is serving, so wait for it to answer. */
async function waitForVite() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fetch(devServer, { signal: AbortSignal.timeout(500) })
      return true
    } catch {
      await Bun.sleep(200)
    }
  }
  return false
}

if (!(await waitForVite())) {
  console.error(`[desktop] Vite never came up on ${devServer}`)
  vite.kill()
  process.exit(1)
}

const host = Bun.spawn(['deno', 'task', '--config', 'deno.json', 'host:hmr'], {
  cwd: import.meta.dir + '/..',
  env: {
    ...process.env,
    LOORA_DESKTOP_DEV_SERVER: devServer,
    LOORA_DESKTOP_PORT: HOST_PORT,
  },
  stdio: ['inherit', 'inherit', 'inherit'],
})

const stop = () => {
  vite.kill()
  host.kill()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

const code = await host.exited
stop()
process.exit(code)
