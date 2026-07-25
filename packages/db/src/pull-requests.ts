export const PULL_REQUEST_STATUSES = ['open', 'merged', 'closed'] as const

export type PullRequestStatus = (typeof PULL_REQUEST_STATUSES)[number]

export const PULL_REQUEST_TITLE_MAX = 200
export const PULL_REQUEST_BODY_MAX = 4_000
export const PULL_REQUEST_COMMENT_MAX = 4_000
export const PULL_REQUEST_AUTHOR_MAX = 60

// A review link is public, so an unbounded thread is an unbounded public
// write target. Cheap ceiling, far above any real design review.
export const PULL_REQUEST_COMMENT_LIMIT = 500

// The review page is anonymous, so `/api/asset/…` inside element code would
// 401 when a preview frame loads it; point those at the PR-scoped route.
export function rewriteAssetUrls<T>(value: T, prId: string): T {
  return JSON.parse(
    JSON.stringify(value).split('/api/asset/').join(`/api/pr/${encodeURIComponent(prId)}/asset/`),
  ) as T
}

export type ReviewCommentInput = { authorName: string; body: string }

export type ReviewCommentCheck =
  | { ok: true; authorName: string; body: string }
  | { ok: false; error: string; status: number }

export function checkReviewComment(input: ReviewCommentInput): ReviewCommentCheck {
  const authorName = input.authorName.trim().slice(0, PULL_REQUEST_AUTHOR_MAX)
  const body = input.body.trim()
  if (!authorName) return { ok: false, error: 'Add a name to comment with.', status: 400 }
  if (!body) return { ok: false, error: 'Write a comment first.', status: 400 }
  if (body.length > PULL_REQUEST_COMMENT_MAX) {
    return { ok: false, error: 'That comment is too long.', status: 400 }
  }
  return { ok: true, authorName, body }
}
