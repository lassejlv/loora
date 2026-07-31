import {
  AGENT_ACTIVITY_SETTLED_TTL_MS,
  AGENT_ACTIVITY_WORKING_TTL_MS,
  canvasRealtimeChannel,
  publishCanvasAgentActivity,
  type CanvasRealtimeTarget,
} from '@loora/db/canvas-realtime'

/**
 * What each tool looks like to somebody watching the editor. Tools missing from
 * this map — usage checks, listings, anything without a design — publish
 * nothing, so the badge never lights up for work that is invisible anyway.
 */
const TOOL_LABELS: Record<string, string> = {
  getDesignContext: 'Reading the design',
  readTree: 'Reading the layers',
  readNode: 'Inspecting a layer',
  searchNodes: 'Searching the canvas',
  viewNode: 'Looking at a layer',
  viewPage: 'Looking at a page',
  viewCanvas: 'Looking at the canvas',
  getScreenshot: 'Taking a screenshot',
  exportCode: 'Exporting code',
  createPage: 'Adding a page',
  insertNodes: 'Adding elements',
  patchNodes: 'Editing elements',
  moveNodes: 'Moving elements',
  deleteNodes: 'Deleting elements',
  createComponent: 'Creating a component',
  createInstance: 'Placing a component',
  setTokens: 'Updating tokens',
  setAnimations: 'Defining animations',
  animateNodes: 'Animating elements',
  renameDesign: 'Renaming the design',
  listVersions: 'Reading version history',
  listBranches: 'Reading branches',
  createBranch: 'Creating a branch',
  proposeBranch: 'Proposing a branch',
  reopenBranch: 'Reopening a branch',
  compareBranch: 'Comparing a branch',
  applyBranch: 'Applying a branch',
  closeBranch: 'Closing a branch',
}

/** The overlay rings one node; the rest are only there to pick a visible one. */
const MAX_NODE_IDS = 24

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function pushId(into: string[], value: unknown) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 128 ||
    into.includes(value)
  ) {
    return
  }
  into.push(value)
}

function pushRef(into: string[], value: unknown) {
  if (record(value)) pushId(into, value.nodeId)
}

/**
 * Which nodes this call is about, read from the arguments rather than the
 * result: the editor can ring them the moment the call starts instead of after
 * it lands.
 */
export function agentActivityNodeIds(args: unknown) {
  const ids: string[] = []
  if (!record(args)) return ids
  if (Array.isArray(args.changes)) {
    for (const change of args.changes) {
      if (!record(change)) continue
      pushRef(ids, change.ref)
      pushId(ids, change.nodeId)
    }
  }
  if (Array.isArray(args.nodeIds)) {
    for (const id of args.nodeIds) pushId(ids, id)
  }
  pushRef(ids, args.ref)
  pushRef(ids, args.parent)
  pushRef(ids, args.root)
  pushId(ids, args.componentId)
  pushId(ids, args.pageId)
  return ids.slice(0, MAX_NODE_IDS)
}

export function agentActivityTarget(
  args: unknown,
): CanvasRealtimeTarget | null {
  if (!record(args)) return null
  const designId =
    typeof args.designId === 'string' ? args.designId.trim() : ''
  if (designId.length === 0 || designId.length > 128) return null
  const draftId =
    typeof args.draftId === 'string' && args.draftId.trim().length > 0
      ? args.draftId.trim()
      : null
  return { designId, draftId }
}

interface AgentRun {
  id: string
  depth: number
}

/**
 * One run per document, not per tool call. Parallel calls share it and only the
 * last one to finish settles it, so the editor shows a single continuous agent
 * rather than a badge that flickers between every read and write.
 */
const runs = new Map<string, AgentRun>()

export interface AgentActivityHandle {
  end: () => void
}

type PublishAgentActivity = typeof publishCanvasAgentActivity

export function trackAgentActivity(
  userId: string,
  toolName: string,
  args: unknown,
  publish: PublishAgentActivity = publishCanvasAgentActivity,
): AgentActivityHandle | null {
  const label = TOOL_LABELS[toolName]
  const target = agentActivityTarget(args)
  if (!label || !target) return null

  const key = canvasRealtimeChannel(userId, target)
  const run = runs.get(key) ?? {
    id: `agent_${globalThis.crypto.randomUUID()}`,
    depth: 0,
  }
  run.depth += 1
  runs.set(key, run)

  const nodeIds = agentActivityNodeIds(args)
  const startedAt = Date.now()
  void publish(userId, target, {
    id: run.id,
    label,
    nodeIds,
    phase: 'working',
    updatedAt: startedAt,
    expiresAt: startedAt + AGENT_ACTIVITY_WORKING_TTL_MS,
  })

  let ended = false
  return {
    end: () => {
      if (ended) return
      ended = true
      run.depth -= 1
      if (run.depth > 0) return
      runs.delete(key)
      const settledAt = Date.now()
      void publish(userId, target, {
        id: run.id,
        label,
        nodeIds,
        phase: 'settled',
        updatedAt: settledAt,
        expiresAt: settledAt + AGENT_ACTIVITY_SETTLED_TTL_MS,
      })
    },
  }
}
