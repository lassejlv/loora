import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import {
  githubEnabled,
  processGitHubWebhook,
  verifyGitHubWebhook,
} from '@loora/auth/github'

export const Route = createFileRoute('/api/github/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!githubEnabled) return new Response('Not found', { status: 404 })
        const rawBody = await request.text()
        if (!await verifyGitHubWebhook(rawBody, request.headers.get('x-hub-signature-256'))) {
          return new Response('Invalid signature', { status: 401 })
        }
        try {
          const payload = JSON.parse(rawBody) as Record<string, unknown>
          await processGitHubWebhook(request.headers.get('x-github-event') ?? '', payload)
          return new Response(null, { status: 204 })
        } catch {
          return new Response('Invalid payload', { status: 400 })
        }
      },
    },
  },
})
