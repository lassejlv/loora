import { createAuthClient } from 'better-auth/react'
import { inferAdditionalFields } from 'better-auth/client/plugins'
import { polarClient } from '@polar-sh/better-auth/client'
import type { auth } from './auth'

export const authClient = createAuthClient({
  plugins: [polarClient(), inferAdditionalFields<typeof auth>()],
})
