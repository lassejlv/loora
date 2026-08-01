import { configureRuntime } from '@loora/platform'

/**
 * Imported before anything else, because `@loora/auth/client` reads the
 * runtime the moment it is created.
 *
 * The API origin stays empty: this window is served by the host process, and
 * the host is what forwards `/api/*` on to Loora with the session attached.
 * Only what leaves the app has to name somewhere else — a share link, a
 * hand-off URL, a checkout page.
 */
configureRuntime({
  platform: 'desktop',
  appOrigin: import.meta.env.VITE_LOORA_APP_ORIGIN ?? 'https://loora.design',
  // A window that followed a checkout link would stop being Loora. The host
  // opens it in a browser instead, and the window stays where it was.
  openExternal: (url) => {
    void fetch('/desktop/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    })
  },
})
