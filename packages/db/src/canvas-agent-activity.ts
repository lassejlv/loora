import { and, desc, eq, gt, lt } from 'drizzle-orm'
import { db } from './index'
import { canvasAgentActivity } from './schema'
import { publishCanvasRealtimeEvent } from './canvas-realtime'

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
  expiresAt: number
}

const WORKING_TTL_MS = 30_000
const SETTLED_TTL_MS = 2_600
const MAX_ACTIVITY_NODE_IDS = 64

function targetKey(draftId: string | null | undefined) {
  return draftId ? `draft:${draftId}` : 'main'
}

function targetFromKey(designId: string, key: string) {
  return {
    designId,
    draftId: key.startsWith('draft:') ? key.slice('draft:'.length) : null,
  }
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
  const label = input.label.slice(0, 160)
  const nodeIds = normalizedNodeIds(input.nodeIds)
  const expiresAt = new Date(now.getTime() + WORKING_TTL_MS)
  await db.insert(canvasAgentActivity).values({
    id,
    designId: target.designId,
    userId,
    targetKey: key,
    label,
    nodeIds,
    phase: 'working',
    startedAt: now,
    updatedAt: now,
    expiresAt,
  })
  void publishCanvasRealtimeEvent(userId, target, {
    type: 'agent.activity',
    activity: {
      id,
      label,
      nodeIds,
      phase: 'working',
      updatedAt: now.getTime(),
      expiresAt: expiresAt.getTime(),
    },
  })
  return id
}

export async function settleCanvasAgentActivity(
  userId: string,
  activityId: string,
  nodeIds: string[],
) {
  const now = new Date()
  const normalized = normalizedNodeIds(nodeIds)
  const expiresAt = new Date(now.getTime() + SETTLED_TTL_MS)
  const [updated] = await db
    .update(canvasAgentActivity)
    .set({
      nodeIds: normalized,
      phase: 'settled',
      updatedAt: now,
      expiresAt,
    })
    .where(
      and(
        eq(canvasAgentActivity.id, activityId),
        eq(canvasAgentActivity.userId, userId),
      ),
    )
    .returning({
      designId: canvasAgentActivity.designId,
      targetKey: canvasAgentActivity.targetKey,
      label: canvasAgentActivity.label,
    })
  if (updated) {
    void publishCanvasRealtimeEvent(
      userId,
      targetFromKey(updated.designId, updated.targetKey),
      {
        type: 'agent.activity',
        activity: {
          id: activityId,
          label: updated.label,
          nodeIds: normalized,
          phase: 'settled',
          updatedAt: now.getTime(),
          expiresAt: expiresAt.getTime(),
        },
      },
    )
  }
}

export async function clearCanvasAgentActivity(
  userId: string,
  activityId: string,
) {
  const [deleted] = await db
    .delete(canvasAgentActivity)
    .where(
      and(
        eq(canvasAgentActivity.id, activityId),
        eq(canvasAgentActivity.userId, userId),
      ),
    )
    .returning({
      designId: canvasAgentActivity.designId,
      targetKey: canvasAgentActivity.targetKey,
    })
  if (deleted) {
    void publishCanvasRealtimeEvent(
      userId,
      targetFromKey(deleted.designId, deleted.targetKey),
      {
        type: 'agent.activity',
        activity: null,
      },
    )
  }
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
      expiresAt: canvasAgentActivity.expiresAt,
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
        expiresAt: activity.expiresAt.getTime(),
      }
    : null
}
