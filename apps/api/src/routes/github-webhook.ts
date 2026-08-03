import {
  githubEnabled,
  processGitHubWebhook,
  verifyGitHubWebhook,
} from '@loora/auth/github'
import {
  callerIdentity,
  rateLimit,
  rateLimits,
  tooManyRequestsResponse,
} from '@loora/rpc/rate-limit'

export async function handleGitHubWebhook(request: Request) {
  if (!githubEnabled) return new Response('Not found', { status: 404 })
  // Deliveries are signed, so this only limits unsigned noise before verification.
  const decision = await rateLimit(
    'github-webhook',
    callerIdentity(request.headers),
    rateLimits.githubWebhook,
  )
  if (!decision.ok) return tooManyRequestsResponse(decision)

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
}
