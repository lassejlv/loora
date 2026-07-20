import { createAuthClient } from 'better-auth/react'
import { inferAdditionalFields, oidcClient } from 'better-auth/client/plugins'
import { polarClient } from '@polar-sh/better-auth/client'
import type { auth } from './auth'

export const authClient = createAuthClient({
  // oidcClient provides oauth2.consent for the MCP approval page.
  plugins: [polarClient(), inferAdditionalFields<typeof auth>(), oidcClient()],
})
