import { useCallback, useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  PullRequestView,
  type PullRequestPayload,
  type ReviewComment,
} from '#/components/pull-request-view'

// Public review page. No auth: the id in the URL is the capability. A guest
// comments under a name they type (remembered per browser); a signed-in Loora
// user comments as their account, which the server decides — not this page.

export const Route = createFileRoute('/pr/$prId')({
  component: PullRequestPage,
  ssr: false,
})

const NAME_KEY = 'loora:review-name'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      payload: PullRequestPayload & { viewerIsOwner: boolean; viewerName: string | null }
    }

// The thread is the live part of the page; refetching the whole payload every
// few seconds would re-diff the canvas, so only comments poll.
const POLL_MS = 10_000

function PullRequestPage() {
  const { prId } = Route.useParams()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [comments, setComments] = useState<ReviewComment[]>([])
  const [guestName, setGuestName] = useState('')

  useEffect(() => {
    setGuestName(localStorage.getItem(NAME_KEY) ?? '')
  }, [])

  const load = useCallback(async () => {
    const response = await fetch(`/api/pr/${encodeURIComponent(prId)}`)
    const body = (await response.json()) as
      | (PullRequestPayload & { viewerIsOwner: boolean; viewerName: string | null })
      | { error: string }
    if (!response.ok || 'error' in body) {
      setState({
        status: 'error',
        message: 'error' in body ? body.error : 'This review link is no longer available.',
      })
      return
    }
    setState({ status: 'ready', payload: body })
    setComments(body.comments)
  }, [prId])

  useEffect(() => {
    void load().catch(() => {
      setState({ status: 'error', message: 'Could not load this pull request.' })
    })
  }, [load])

  useEffect(() => {
    if (state.status !== 'ready') return
    const timer = setInterval(() => {
      if (document.hidden) return
      void fetch(`/api/pr/${encodeURIComponent(prId)}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((body: PullRequestPayload | null) => {
          if (body?.comments) setComments(body.comments)
        })
        .catch(() => {})
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [prId, state.status])

  useEffect(() => {
    document.title = state.status === 'ready' ? `${state.payload.title} · loora` : 'loora'
  }, [state])

  const postComment = async ({ authorName, body }: { authorName: string; body: string }) => {
    const response = await fetch(`/api/pr/${encodeURIComponent(prId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authorName, body }),
    })
    const result = (await response.json()) as
      | { comments: ReviewComment[] }
      | { error: string }
    if (!response.ok || 'error' in result) {
      throw new Error('error' in result ? result.error : 'Could not post that comment.')
    }
    localStorage.setItem(NAME_KEY, authorName)
    setGuestName(authorName)
    setComments(result.comments)
  }

  if (state.status === 'loading') {
    return (
      <main className="grid min-h-screen place-items-center bg-cx-canvas">
        <p className="cx-shimmer text-sm">Loading pull request…</p>
      </main>
    )
  }

  if (state.status === 'error') {
    return (
      <main className="grid min-h-screen place-items-center bg-cx-canvas">
        <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border bg-card px-5 py-4 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">{state.message}</p>
          <Link to="/" className="text-xs font-medium underline underline-offset-2">
            Made with loora
          </Link>
        </div>
      </main>
    )
  }

  const pr = state.payload

  return (
    <main className="flex min-h-screen flex-col gap-4 bg-cx-canvas px-4 py-6 md:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="truncate text-xl font-medium">{pr.title}</h1>
          <span className="shrink-0 text-xs text-muted-foreground">
            opened by {pr.ownerName}
          </span>
        </div>
        <div className="flex min-h-[70svh] flex-1 flex-col rounded-xl border bg-card p-4">
          <PullRequestView
            pr={pr}
            comments={comments}
            canComment={pr.status === 'open'}
            commentAs={pr.viewerName}
            defaultAuthorName={guestName}
            onComment={postComment}
          />
        </div>
        <Link
          to="/"
          className="self-center text-[11px] text-muted-foreground underline underline-offset-2"
        >
          Made with loora
        </Link>
      </div>
    </main>
  )
}
