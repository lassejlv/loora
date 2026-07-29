import { and, desc, eq, gt, lt } from 'drizzle-orm'
import { db } from './index'
import { canvasAgentActivity } from './schema'

export interface CanvasAgentActivityTarget {
  designId: string
  draftId?: string | null
}

export interface ActiveCanvasAgentActivity {
  id: string
  label: string
  nodeIds: string[]
  phase: 'working' | 'settled'
  updatedAt: number
}

const WORKING_TTL_MS = 30_000
const SETTLED_TTL_MS = 2_600
const MAX_ACTIVITY_NODE_IDS = 64

function targetKey(draftId: string | null | undefined) {
  return draftId ? `draft:${draftId}` : 'main'
}

function normalizedNodeIds(nodeIds: string[]) {
  return [...new Set(nodeIds.filter(Boolean))].slice(0, MAX_ACTIVITY_NODE_IDS)
}

export async function beginCanvasAgentActivity(
  userId: string,
  target: CanvasAgentActivityTarget,
  input: {
    label: string
    nodeIds: string[]
  },
) {
  const now = new Date()
  const key = targetKey(target.draftId)
  await db
    .delete(canvasAgentActivity)
    .where(
      and(
        eq(canvasAgentActivity.userId, userId),
        eq(canvasAgentActivity.designId, target.designId),
        eq(canvasAgentActivity.targetKey, key),
        lt(canvasAgentActivity.expiresAt, now),
      ),
    )

  const id = `activity_${globalThis.crypto.randomUUID()}`
  await db.insert(canvasAgentActivity).values({
    id,
    designId: target.designId,
    userId,
    targetKey: key,
    label: input.label.slice(0, 160),
    nodeIds: normalizedNodeIds(input.nodeIds),
    phase: 'working',
    startedAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + WORKING_TTL_MS),
  })
  return id
}

export async function settleCanvasAgentActivity(
  userId: string,
  activityId: string,
  nodeIds: string[],
) {
  const now = new Date()
  await db
    .update(canvasAgentActivity)
    .set({
      nodeIds: normalizedNodeIds(nodeIds),
      phase: 'settled',
      updatedAt: now,
      expiresAt: new Date(now.getTime() + SETTLED_TTL_MS),
    })
    .where(
      and(
        eq(canvasAgentActivity.id, activityId),
        eq(canvasAgentActivity.userId, userId),
      ),
    )
}

export async function clearCanvasAgentActivity(
  userId: string,
  activityId: string,
) {
  await db
    .delete(canvasAgentActivity)
    .where(
      and(
        eq(canvasAgentActivity.id, activityId),
        eq(canvasAgentActivity.userId, userId),
      ),
    )
}

export async function getCanvasAgentActivity(
  userId: string,
  target: CanvasAgentActivityTarget,
): Promise<ActiveCanvasAgentActivity | null> {
  const [activity] = await db
    .select({
      id: canvasAgentActivity.id,
      label: canvasAgentActivity.label,
      nodeIds: canvasAgentActivity.nodeIds,
      phase: canvasAgentActivity.phase,
      updatedAt: canvasAgentActivity.updatedAt,
    })
    .from(canvasAgentActivity)
    .where(
      and(
        eq(canvasAgentActivity.userId, userId),
        eq(canvasAgentActivity.designId, target.designId),
        eq(canvasAgentActivity.targetKey, targetKey(target.draftId)),
        gt(canvasAgentActivity.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(canvasAgentActivity.updatedAt))
    .limit(1)

  return activity
    ? {
        ...activity,
        nodeIds: normalizedNodeIds(activity.nodeIds),
        updatedAt: activity.updatedAt.getTime(),
      }
    : null
}
