import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { auth, getSession } from '#/lib/auth'
import {
  canUseApp,
  isPreviewProtectedAuthPath,
  previewAccessRequiredResponse,
} from '#/lib/preview-access'

async function handle(request: Request) {
  if (isPreviewProtectedAuthPath(new URL(request.url).pathname)) {
    const session = await getSession(request)
    if (session && !canUseApp(session.user)) return previewAccessRequiredResponse()
  }
  return auth.handler(request)
}

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
})
