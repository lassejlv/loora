import { configureRuntime } from '@loora/platform'

/**
 * Imported before anything else, because `@loora/auth/client` reads the API
 * origin the moment it is created.
 *
 * The API origin stays empty: this window is served by the host process, and
 * the host is what forwards `/api/*` on to Loora with the session attached.
 * Only links meant for a browser — a share link, a hand-off URL — have to name
 * the public app.
 */
configureRuntime({
  platform: 'desktop',
  appOrigin: import.meta.env.VITE_LOORA_APP_ORIGIN ?? 'https://loora.design',
})
