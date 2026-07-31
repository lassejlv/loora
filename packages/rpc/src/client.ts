import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { RouterClient } from '@orpc/server'
import type { appRouter } from './router.ts'

/**
 * The browser half of the router. `appRouter` is a type-only import, so none
 * of the server implementation follows it into the client bundle.
 */
const link = new RPCLink({
  url: () => `${window.location.origin}/api/rpc`,
})

export const orpc: RouterClient<typeof appRouter> = createORPCClient(link)
