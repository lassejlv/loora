import {
  CANVAS_SCHEMA_VERSION,
  canvasId,
  orderedChildren,
  parseCanvasDocument,
  type CanvasDocument,
  type CanvasNode,
  type NodeId,
} from '@loora/canvas/model'

/** Marks our payload so a paste from anywhere else falls through to plain text. */
export const CLIPBOARD_KIND = 'loora/canvas'

export interface CanvasClipboardPayload {
  kind: typeof CLIPBOARD_KIND
  schemaVersion: number
  /** Source ids of the copied roots, in document order. */
  roots: NodeId[]
  nodes: Record<NodeId, CanvasNode>
}

/**
 * Collects the selected source nodes with their whole subtrees. Refs inside an
 * instance are skipped: their structure belongs to the component, so copying
 * one would duplicate something the document does not own.
 */
export function buildClipboardPayload(
  document: CanvasDocument,
  nodeIds: NodeId[],
): CanvasClipboardPayload | null {
  const wanted = nodeIds.filter((id) => document.nodes[id])
  if (wanted.length === 0) return null

  // Dropping ids that already travel inside another selected subtree keeps the
  // paste from duplicating them twice.
  const ancestry = (id: NodeId) => {
    const chain: NodeId[] = []
    let parentId = document.nodes[id]?.parentId ?? null
    while (parentId) {
      chain.push(parentId)
      parentId = document.nodes[parentId]?.parentId ?? null
    }
    return chain
  }
  const selected = new Set(wanted)
  const roots = wanted.filter((id) => !ancestry(id).some((parent) => selected.has(parent)))

  const nodes: Record<NodeId, CanvasNode> = {}
  const collect = (id: NodeId) => {
    const node = document.nodes[id]
    if (!node || nodes[id]) return
    nodes[id] = structuredClone(node)
    for (const child of orderedChildren(document, id)) collect(child.id)
  }
  for (const id of roots) collect(id)

  const ordered = roots
    .map((id) => document.nodes[id]!)
    .sort((left, right) => left.order - right.order)
    .map((node) => node.id)

  return {
    kind: CLIPBOARD_KIND,
    schemaVersion: CANVAS_SCHEMA_VERSION,
    roots: ordered,
    nodes,
  }
}

function looksLikeNode(value: unknown): value is CanvasNode {
  if (typeof value !== 'object' || value === null) return false
  const node = value as Record<string, unknown>
  return (
    typeof node.id === 'string' &&
    typeof node.type === 'string' &&
    (node.parentId === null || typeof node.parentId === 'string') &&
    typeof node.order === 'number' &&
    typeof node.layout === 'object' &&
    node.layout !== null &&
    typeof node.style === 'object' &&
    node.style !== null
  )
}

/**
 * Clipboard text is untrusted, so this only establishes that the payload is
 * ours and structurally node-shaped. Every field is checked for real by
 * `validatePaste` against the document the nodes are about to join.
 */
export function parseClipboardPayload(text: string): CanvasClipboardPayload | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as { kind?: unknown }).kind !== CLIPBOARD_KIND
  ) {
    return null
  }
  const payload = value as CanvasClipboardPayload
  if (
    payload.schemaVersion !== CANVAS_SCHEMA_VERSION ||
    !Array.isArray(payload.roots) ||
    payload.roots.length === 0 ||
    payload.roots.length > 1_000 ||
    typeof payload.nodes !== 'object' ||
    payload.nodes === null ||
    Object.keys(payload.nodes).length > 10_000
  ) {
    return null
  }
  for (const [id, node] of Object.entries(payload.nodes)) {
    if (!looksLikeNode(node) || node.id !== id) return null
  }
  return payload.roots.every((id) => payload.nodes[id]) ? payload : null
}

/** True when the pasted nodes leave the document valid by the model's rules. */
export function validatePaste(document: CanvasDocument, nodes: CanvasNode[]) {
  try {
    parseCanvasDocument({
      ...document,
      nodes: {
        ...document.nodes,
        ...Object.fromEntries(nodes.map((node) => [node.id, node])),
      },
    })
    return true
  } catch {
    return false
  }
}

export interface PastedNodes {
  nodes: CanvasNode[]
  rootIds: NodeId[]
}

/**
 * Rebuilds the payload under `parentId` with fresh ids. Absolute roots are
 * nudged so a paste on top of the original is visible; flow roots simply append.
 */
export function pasteNodes(
  document: CanvasDocument,
  payload: CanvasClipboardPayload,
  parentId: NodeId,
  offset = 16,
): PastedNodes {
  const ids = new Map<NodeId, NodeId>()
  for (const id of Object.keys(payload.nodes)) {
    ids.set(id, canvasId(payload.nodes[id]!.type))
  }
  const lastOrder = orderedChildren(document, parentId).at(-1)?.order ?? 0
  const nodes: CanvasNode[] = []

  payload.roots.forEach((rootId, index) => {
    const walk = (sourceId: NodeId, nextParentId: NodeId, isRoot: boolean) => {
      const source = payload.nodes[sourceId]
      if (!source) return
      const clone = structuredClone(source) as CanvasNode
      clone.id = ids.get(sourceId)!
      clone.parentId = nextParentId
      if (isRoot) {
        clone.order = lastOrder + (index + 1) * 1024
        if (clone.layout.position === 'absolute') {
          clone.layout = {
            ...clone.layout,
            x: clone.layout.x + offset,
            y: clone.layout.y + offset,
          }
        }
      }
      if (clone.type === 'instance') {
        clone.componentId = ids.get(clone.componentId) ?? clone.componentId
        clone.overrides = Object.fromEntries(
          Object.entries(clone.overrides).map(([target, patch]) => [
            ids.get(target) ?? target,
            patch,
          ]),
        )
      }
      nodes.push(clone)
      const children = Object.values(payload.nodes)
        .filter((child) => child.parentId === sourceId)
        .sort((left, right) => left.order - right.order)
      for (const child of children) walk(child.id, clone.id, false)
    }
    walk(rootId, parentId, true)
  })

  return {
    nodes,
    rootIds: payload.roots.map((id) => ids.get(id)!),
  }
}
