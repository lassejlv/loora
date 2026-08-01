import { createAuthClient } from 'better-auth/react'
import {
  inferAdditionalFields,
  oidcClient,
  oneTimeTokenClient,
} from 'better-auth/client/plugins'
import { polarClient } from '@polar-sh/better-auth/client'
import { apiOrigin } from '@loora/platform'
import type { auth } from './auth'

export const authClient = createAuthClient({
  // Empty on the web, where the app is served by the origin it calls. The
  // desktop app is served by its own loopback proxy, which is also same
  // origin — so this only ever differs if a client is pointed elsewhere.
  baseURL: apiOrigin() || undefined,
  plugins: [
    polarClient(),
    inferAdditionalFields<typeof auth>(),
    // oidcClient provides oauth2.consent for the MCP approval page.
    oidcClient(),
    // oneTimeTokenClient mints the hand-off code the desktop app trades for a
    // session after signing in at loora.design.
    oneTimeTokenClient(),
  ],
})
