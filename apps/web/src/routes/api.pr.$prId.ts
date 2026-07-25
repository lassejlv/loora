import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { requireSession } from '@loora/auth'
import {
  addReviewComment,
  buildReviewPayload,
  getReviewTarget,
  listReviewComments,
} from '@loora/rpc/pull-requests'
import { publishEgressExceeded, recordPublishEgress } from '@loora/rpc/publish'

// Public review endpoint for a pull request. No auth: the id in the URL is the
// capability. Reviewers read the diff and post to the thread; everything else
// about the design stays behind the owner's session.

const publicHeaders = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

const missing = () =>
  Response.json(
    { error: 'This review link was removed or is no longer available.' },
    { status: 404, headers: publicHeaders },
  )

export const Route = createFileRoute('/api/pr/$prId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const found = await buildReviewPayload(params.prId)
        if (!found) return missing()
        if (await publishEgressExceeded(found.userId, found.isAdmin)) {
          return Response.json(
            { error: 'This review is temporarily unavailable — its bandwidth limit was reached.' },
            { status: 429, headers: publicHeaders },
          )
        }
        const session = await requireSession(request)
        const body = JSON.stringify({
          ...found.payload,
          viewerIsOwner: session?.user.id === found.userId,
          viewerName: session?.user.name ?? null,
        })
        await recordPublishEgress(found.userId, new TextEncoder().encode(body).byteLength)
        return new Response(body, { headers: publicHeaders })
      },

      POST: async ({ request, params }) => {
        const found = await getReviewTarget(params.prId)
        if (!found) return missing()
        if (found.status !== 'open') {
          return Response.json(
            { error: 'This pull request is closed.' },
            { status: 409, headers: publicHeaders },
          )
        }

        const input = (await request.json().catch(() => null)) as {
          authorName?: unknown
          body?: unknown
        } | null
        if (typeof input?.body !== 'string' || typeof input?.authorName !== 'string') {
          return Response.json(
            { error: 'Write a comment first.' },
            { status: 400, headers: publicHeaders },
          )
        }

        // A signed-in Loora user comments as their account; the typed name is
        // only trusted for guests, who have no identity to check it against.
        const session = await requireSession(request)
        const result = await addReviewComment({
          prId: found.id,
          authorName: session?.user.name || input.authorName,
          body: input.body,
          authorUserId: session?.user.id ?? null,
          isOwner: session?.user.id === found.userId,
        })
        if (!result.ok) {
          return Response.json(
            { error: result.error },
            { status: result.status, headers: publicHeaders },
          )
        }
        return Response.json(
          { comment: result.comment, comments: await listReviewComments(found.id) },
          { headers: publicHeaders },
        )
      },
    },
  },
})
