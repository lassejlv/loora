import { useMemo, useState } from 'react'
import { GitBranchIcon } from 'lucide-react'
import type { CanvasElement } from '#/lib/canvas'
import { diffCanvas, type ElementChange } from '#/lib/canvas-diff'
import { DesignDiff } from '#/components/design-diff'
import { ElementFrame } from '#/components/element-frame'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Spinner } from '#/components/ui/spinner'
import { cn } from '#/lib/utils'

export type PullRequestStatus = 'open' | 'merged' | 'closed'

export interface ReviewComment {
  id: string
  authorName: string
  isOwner: boolean
  body: string
  createdAt: number
}

export interface ReviewCommit {
  id: string
  message: string
  added: number
  removed: number
  changed: number
  createdAt: number
}

export interface PullRequestPayload {
  id: string
  title: string
  body: string
  status: PullRequestStatus
  designName: string
  branchName: string
  ownerName: string
  createdAt: number
  mergedAt: number | null
  closedAt: number | null
  mainShapes: CanvasElement[]
  branchShapes: CanvasElement[]
  commits: ReviewCommit[]
  comments: ReviewComment[]
}

const STATUS_STYLE: Record<PullRequestStatus, string> = {
  open: 'bg-success/12 text-success-foreground',
  merged: 'bg-cx-accent/15 text-cx-accent',
  closed: 'bg-muted text-muted-foreground',
}

const STATUS_LABEL: Record<PullRequestStatus, string> = {
  open: 'Open',
  merged: 'Merged',
  closed: 'Closed',
}

const timeLabel = (value: number) =>
  new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

type Tab = 'changes' | 'preview' | 'commits'

export function PullRequestStatusBadge({ status }: { status: PullRequestStatus }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
        STATUS_STYLE[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

/**
 * The whole pull request surface: diff, rendered before/after, commit log and
 * the review thread. Rendered for the owner inside the editor and for anyone
 * holding the review link on the public page, so it takes its data as props and
 * leaves posting to the caller (oRPC for the owner, the public route for guests).
 */
export function PullRequestView({
  pr,
  comments,
  canComment,
  commentAs,
  defaultAuthorName,
  onComment,
  onDeleteComment,
  header,
}: {
  pr: PullRequestPayload
  comments: ReviewComment[]
  canComment: boolean
  /** Preset author name for signed-in viewers; guests type their own. */
  commentAs?: string | null
  /** Name a returning guest used last time, from their own browser. */
  defaultAuthorName?: string
  onComment: (input: { authorName: string; body: string }) => Promise<void>
  onDeleteComment?: (commentId: string) => Promise<void>
  header?: React.ReactNode
}) {
  const [tab, setTab] = useState<Tab>('changes')
  const diff = useMemo(
    () => diffCanvas(pr.mainShapes, pr.branchShapes),
    [pr.mainShapes, pr.branchShapes],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <PullRequestStatusBadge status={pr.status} />
        <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
          <GitBranchIcon className="size-3.5 shrink-0" />
          <span className="truncate">
            {pr.branchName} → Main{pr.designName ? ` · ${pr.designName}` : ''}
          </span>
        </span>
        <span className="text-xs text-muted-foreground">
          {diff.added} added, {diff.removed} removed, {diff.changed} changed
        </span>
        {header}
      </header>

      {pr.body ? (
        <p className="whitespace-pre-wrap rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          {pr.body}
        </p>
      ) : null}

      <div className="flex gap-1">
        {(['changes', 'preview', 'commits'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              tab === value
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:bg-secondary/60',
            )}
          >
            {value === 'commits' ? `Commits (${pr.commits.length})` : value}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-h-0 overflow-hidden rounded-lg border">
          {tab === 'changes' ? (
            <DesignDiff
              oldShapes={pr.mainShapes}
              newShapes={pr.branchShapes}
              oldKey={`pr:${pr.id}:main`}
              newKey={`pr:${pr.id}:branch:${pr.commits[0]?.id ?? '0'}`}
            />
          ) : tab === 'preview' ? (
            <ChangePreviews prId={pr.id} changes={diff.changes} />
          ) : (
            <CommitList commits={pr.commits} />
          )}
        </div>

        <ReviewThread
          key={defaultAuthorName ?? ''}
          comments={comments}
          canComment={canComment}
          commentAs={commentAs}
          defaultAuthorName={defaultAuthorName}
          onComment={onComment}
          onDeleteComment={onDeleteComment}
        />
      </div>
    </div>
  )
}

// Rendered before/after for every changed element. Frames are non-interactive
// and scaled to the column so a 1440px hero stays readable next to a button.
function ChangePreviews({ prId, changes }: { prId: string; changes: ElementChange[] }) {
  const renderable = changes.filter((change) => change.oldCode || change.newCode)
  if (renderable.length === 0) {
    return (
      <p className="grid h-full place-items-center p-6 text-sm text-muted-foreground">
        Nothing to preview.
      </p>
    )
  }
  return (
    <div className="h-full space-y-4 overflow-auto overscroll-contain bg-background p-4">
      {renderable.map((change) => (
        <section key={`${change.kind}:${change.id}`} className="overflow-hidden rounded-lg border">
          <header className="flex items-center justify-between gap-2 bg-muted/40 px-3 py-2">
            <span className="truncate text-sm font-medium">
              {change.name || 'Untitled element'}
            </span>
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {change.kind}
            </span>
          </header>
          <div className="grid gap-px bg-border sm:grid-cols-2">
            <PreviewPane
              label="Main"
              frameId={`pr:${prId}:${change.id}:old`}
              elementId={`${change.id}:old`}
              code={change.oldCode}
            />
            <PreviewPane
              label="This branch"
              frameId={`pr:${prId}:${change.id}:new`}
              elementId={`${change.id}:new`}
              code={change.newCode}
            />
          </div>
        </section>
      ))}
    </div>
  )
}

function PreviewPane({
  label,
  frameId,
  elementId,
  code,
}: {
  label: string
  frameId: string
  elementId: string
  code: string
}) {
  return (
    <div className="bg-background">
      <p className="border-b px-3 py-1.5 text-[11px] text-muted-foreground">{label}</p>
      <div className="h-56 bg-white">
        {code ? (
          <ElementFrame
            elementId={elementId}
            frameId={frameId}
            code={code}
            interactive={false}
          />
        ) : (
          <p className="grid h-full place-items-center text-xs text-muted-foreground">
            Not on this side
          </p>
        )}
      </div>
    </div>
  )
}

function CommitList({ commits }: { commits: ReviewCommit[] }) {
  if (commits.length === 0) {
    return (
      <p className="grid h-full place-items-center p-6 text-sm text-muted-foreground">
        No commits on this branch yet.
      </p>
    )
  }
  return (
    <ul className="h-full divide-y overflow-auto overscroll-contain bg-background">
      {commits.map((commit) => (
        <li key={commit.id} className="px-4 py-2.5">
          <p className="truncate text-sm">{commit.message}</p>
          <p className="text-xs text-muted-foreground">
            {timeLabel(commit.createdAt)} · +{commit.added} −{commit.removed} ~{commit.changed}
          </p>
        </li>
      ))}
    </ul>
  )
}

function ReviewThread({
  comments,
  canComment,
  commentAs,
  defaultAuthorName,
  onComment,
  onDeleteComment,
}: {
  comments: ReviewComment[]
  canComment: boolean
  commentAs?: string | null
  defaultAuthorName?: string
  onComment: (input: { authorName: string; body: string }) => Promise<void>
  onDeleteComment?: (commentId: string) => Promise<void>
}) {
  const [name, setName] = useState(defaultAuthorName ?? '')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const author = commentAs ?? name

  const submit = async () => {
    if (!body.trim() || !author.trim() || sending) return
    setSending(true)
    setError(null)
    try {
      await onComment({ authorName: author.trim(), body: body.trim() })
      setBody('')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not post that comment.')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="flex min-h-0 flex-col rounded-lg border">
      <h3 className="border-b px-3 py-2 text-sm font-medium">Discussion</h3>
      <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3">
        {comments.length === 0 ? (
          <li className="text-xs text-muted-foreground">
            No comments yet. Share the review link to get feedback.
          </li>
        ) : (
          comments.map((comment) => (
            <li key={comment.id} className="group/comment">
              <p className="flex items-baseline gap-2">
                <span className="text-sm font-medium">{comment.authorName}</span>
                {comment.isOwner ? (
                  <span className="rounded-full bg-cx-accent/12 px-1.5 text-[10px] text-cx-accent">
                    owner
                  </span>
                ) : null}
                <span className="text-[11px] text-muted-foreground">
                  {timeLabel(comment.createdAt)}
                </span>
                {onDeleteComment ? (
                  <button
                    type="button"
                    className="ms-auto text-[11px] text-muted-foreground opacity-0 transition-opacity hover:text-destructive-foreground focus-visible:opacity-100 group-hover/comment:opacity-100"
                    onClick={() => void onDeleteComment(comment.id)}
                  >
                    Delete
                  </button>
                ) : null}
              </p>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{comment.body}</p>
            </li>
          ))
        )}
      </ul>

      {canComment ? (
        <div className="space-y-2 border-t p-3">
          {commentAs ? (
            <p className="text-[11px] text-muted-foreground">Commenting as {commentAs}</p>
          ) : (
            <Input
              value={name}
              maxLength={60}
              placeholder="Your name"
              aria-label="Your name"
              onChange={(event) => setName(event.target.value)}
            />
          )}
          <textarea
            value={body}
            maxLength={4000}
            rows={3}
            placeholder="Leave a comment"
            aria-label="Comment"
            className="w-full resize-y rounded-md border bg-background px-2.5 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit()
            }}
          />
          {error ? <p className="text-xs text-destructive-foreground">{error}</p> : null}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">⌘↵ to post</span>
            <Button
              size="xs"
              disabled={!body.trim() || !author.trim() || sending}
              onClick={() => void submit()}
            >
              {sending ? <Spinner className="size-3" /> : null}
              Comment
            </Button>
          </div>
        </div>
      ) : (
        <p className="border-t p-3 text-xs text-muted-foreground">
          This pull request is closed to new comments.
        </p>
      )}
    </section>
  )
}
