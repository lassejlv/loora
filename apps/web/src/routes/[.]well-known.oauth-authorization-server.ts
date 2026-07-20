import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { mcpOAuthDiscoveryHandler } from '@loora/auth'

// Better Auth serves this metadata at /api/auth/.well-known/… automatically,
// but MCP clients that fail to read WWW-Authenticate fall back to the site
// root, so it must exist here too.
export const Route = createFileRoute('/.well-known/oauth-authorization-server')({
  server: {
    handlers: {
      GET: ({ request }) => mcpOAuthDiscoveryHandler(request),
    },
  },
})
