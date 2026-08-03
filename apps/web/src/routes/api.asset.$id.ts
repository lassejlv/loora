import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'

export function apiAssetUrl(request: Request, id: string) {
  const requestUrl = new URL(request.url)
  const apiOrigin = requestUrl.hostname === 'localhost'
    ? 'http://localhost:3001'
    : 'https://api.loora.design'
  return new URL(`/api/asset/${encodeURIComponent(id)}`, apiOrigin)
}

export const Route = createFileRoute('/api/asset/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        return Response.redirect(apiAssetUrl(request, params.id), 307)
      },
    },
  },
})
