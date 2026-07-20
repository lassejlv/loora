import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { RouterClient } from '@orpc/server'
import type { appRouter } from '@loora/rpc'

const link = new RPCLink({
  url: () => `${window.location.origin}/api/rpc`,
})

export const orpc: RouterClient<typeof appRouter> = createORPCClient(link)
