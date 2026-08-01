import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { RouterClient } from '@orpc/server'
import { apiUrl } from '@loora/platform'
import type { appRouter } from './router.ts'

/**
 * The browser half of the router. `appRouter` is a type-only import, so none
 * of the server implementation follows it into the client bundle.
 *
 * The URL comes from the platform runtime: the web app calls its own origin,
 * and the desktop app calls the loopback server in its own process, which
 * proxies on to loora.design with the session it holds.
 */
const link = new RPCLink({
  url: () => apiUrl('/api/rpc'),
})

export const orpc: RouterClient<typeof appRouter> = createORPCClient(link)
