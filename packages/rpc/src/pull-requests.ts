import { Buffer } from 'node:buffer'
import { and, asc, count, desc, eq } from 'drizzle-orm'
import { db } from '@loora/db'
import {
  design,
  designDraft,
  designPullRequest,
  designPullRequestComment,
  designVersion,
  user,
} from '@loora/db/schema'
import { canvasDiff } from '@loora/db/drafts'
import type { CanvasElement } from '@loora/db/canvas'
import {
  checkReviewComment,
  PULL_REQUEST_COMMENT_LIMIT,
  rewriteAssetUrls,
} from '@loora/db/pull-requests'
import { authorizeBilling } from '@loora/billing/billing'
import { canUseApp } from '@loora/auth/preview-access'

// 96 random bits, base64url — the row id IS the review capability, so it has
// to be unguessable while still fitting in a link someone pastes in Slack.
export function pullRequestId() {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString('base64url')
}

export function commentId() {
  return `prc${crypto.randomUUID().replaceAll('-', '')}`
}

export async function getReviewTarget(prId: string) {
  if (!prId || prId.length > 64) return null

  const [found] = await db
    .select({
      id: designPullRequest.id,
      title: designPullRequest.title,
      body: designPullRequest.body,
      status: designPullRequest.status,
      createdAt: designPullRequest.createdAt,
      mergedAt: designPullRequest.mergedAt,
      closedAt: designPullRequest.closedAt,
      draftId: designPullRequest.draftId,
      designId: designPullRequest.designId,
      userId: designPullRequest.userId,
      designName: design.name,
      mainShapes: design.shapes,
      branchName: designDraft.name,
      branchShapes: designDraft.shapes,
      ownerName: user.name,
      isAdmin: user.isAdmin,
      previewAccess: user.previewAccess,
    })
    .from(designPullRequest)
    .innerJoin(
      design,
      and(eq(design.id, designPullRequest.designId), eq(design.userId, designPullRequest.userId)),
    )
    .innerJoin(
      designDraft,
      and(
        eq(designDraft.id, designPullRequest.draftId),
        eq(designDraft.userId, designPullRequest.userId),
      ),
    )
    .innerJoin(user, eq(user.id, designPullRequest.userId))
    .where(eq(designPullRequest.id, prId))
    .limit(1)
  if (!found) return null

  // A review link stays only as valid as the owner's own access — the same
  // gate published links use.
  if (
    !canUseApp(found) ||
    !(await authorizeBilling({ id: found.userId, isAdmin: found.isAdmin })).access
  ) {
    return null
  }
  return found
}

export async function listReviewComments(prId: string) {
  const rows = await db
    .select({
      id: designPullRequestComment.id,
      authorName: designPullRequestComment.authorName,
      isOwner: designPullRequestComment.isOwner,
      body: designPullRequestComment.body,
      createdAt: designPullRequestComment.createdAt,
    })
    .from(designPullRequestComment)
    .where(eq(designPullRequestComment.pullRequestId, prId))
    .orderBy(asc(designPullRequestComment.createdAt))
    .limit(PULL_REQUEST_COMMENT_LIMIT)
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.getTime() }))
}

// Commits on the branch, newest first: the version history the editor already
// writes on every checkpoint, scoped to this branch.
export async function listReviewCommits(userId: string, designId: string, draftId: string) {
  const rows = await db
    .select({
      id: designVersion.id,
      message: designVersion.message,
      added: designVersion.added,
      removed: designVersion.removed,
      changed: designVersion.changed,
      createdAt: designVersion.createdAt,
    })
    .from(designVersion)
    .where(
      and(
        eq(designVersion.userId, userId),
        eq(designVersion.designId, designId),
        eq(designVersion.draftId, draftId),
      ),
    )
    .orderBy(desc(designVersion.createdAt))
    .limit(50)
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.getTime() }))
}

export async function buildReviewPayload(prId: string) {
  const found = await getReviewTarget(prId)
  if (!found) return null

  const [comments, commits] = await Promise.all([
    listReviewComments(prId),
    listReviewCommits(found.userId, found.designId, found.draftId),
  ])

  return {
    userId: found.userId,
    isAdmin: found.isAdmin,
    payload: {
      id: found.id,
      title: found.title,
      body: found.body,
      status: found.status,
      designName: found.designName,
      branchName: found.branchName,
      ownerName: found.ownerName,
      createdAt: found.createdAt.getTime(),
      mergedAt: found.mergedAt?.getTime() ?? null,
      closedAt: found.closedAt?.getTime() ?? null,
      summary: canvasDiff(found.mainShapes, found.branchShapes),
      mainShapes: rewriteAssetUrls(found.mainShapes, prId),
      branchShapes: rewriteAssetUrls(found.branchShapes, prId),
      commits,
      comments,
    },
  }
}

// Assets the link may serve: only what Main or the branch actually references,
// never the owner's whole library.
export function reviewShapes(found: { mainShapes: CanvasElement[]; branchShapes: CanvasElement[] }) {
  return [...found.mainShapes, ...found.branchShapes]
}

export type NewReviewComment = {
  prId: string
  authorName: string
  body: string
  authorUserId?: string | null
  isOwner?: boolean
}

export type AddCommentResult =
  | { ok: true; comment: Awaited<ReturnType<typeof listReviewComments>>[number] }
  | { ok: false; error: string; status: number }

export async function addReviewComment(input: NewReviewComment): Promise<AddCommentResult> {
  const checked = checkReviewComment(input)
  if (!checked.ok) return checked

  const [existing] = await db
    .select({ total: count() })
    .from(designPullRequestComment)
    .where(eq(designPullRequestComment.pullRequestId, input.prId))
  if ((existing?.total ?? 0) >= PULL_REQUEST_COMMENT_LIMIT) {
    return { ok: false, error: 'This review thread is full.', status: 429 }
  }

  const [created] = await db
    .insert(designPullRequestComment)
    .values({
      id: commentId(),
      pullRequestId: input.prId,
      authorUserId: input.authorUserId ?? null,
      authorName: checked.authorName,
      isOwner: input.isOwner ?? false,
      body: checked.body,
    })
    .returning({
      id: designPullRequestComment.id,
      authorName: designPullRequestComment.authorName,
      isOwner: designPullRequestComment.isOwner,
      body: designPullRequestComment.body,
      createdAt: designPullRequestComment.createdAt,
    })

  return { ok: true, comment: { ...created, createdAt: created.createdAt.getTime() } }
}
