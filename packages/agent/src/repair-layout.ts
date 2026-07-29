import type { CanvasDocument, CanvasLayout, CanvasNode, NodeId } from '@loora/canvas/model'

/**
 * Repair for documents written before inserted descriptors inherited their
 * parent's flow. Those nodes were pinned to `absolute` at the parent's origin,
 * so a generated page rendered as one pile: every section, label, and image
 * stacked in the same corner.
 *
 * The rewrite is deliberately narrow. A node only moves back into flow when it
 * sits at exactly (0,0) *and* either its parent arranges children itself
 * (flex/grid, which an absolute child contradicts) or it is one of several
 * siblings stacked on the same point. An overlay placed at real coordinates,
 * or a lone absolute child of a plain frame, is left alone.
 */

/** `defaultLayout()`'s box, which text nodes inherited when they asked for nothing. */
const PLACEHOLDER = { width: 320, height: 200 }

function isStackedAtOrigin(node: CanvasNode) {
  return (
    node.parentId !== null &&
    node.layout.position === 'absolute' &&
    (node.layout.x ?? 0) === 0 &&
    (node.layout.y ?? 0) === 0
  )
}

function isPlaceholderBox(layout: CanvasLayout) {
  return (
    layout.width.unit === 'px' &&
    layout.width.value === PLACEHOLDER.width &&
    layout.height.unit === 'px' &&
    layout.height.value === PLACEHOLDER.height
  )
}

export interface LayoutRepair {
  document: CanvasDocument
  /** Nodes pulled back into their parent's flow. */
  flowed: NodeId[]
  /** Text nodes that also lost the 320×200 placeholder box. */
  unboxed: NodeId[]
}

export function repairStackedLayout(source: CanvasDocument): LayoutRepair {
  const stacked = new Set<NodeId>()
  const pile = new Map<NodeId, number>()
  for (const node of Object.values(source.nodes)) {
    if (!isStackedAtOrigin(node)) continue
    stacked.add(node.id)
    pile.set(node.parentId!, (pile.get(node.parentId!) ?? 0) + 1)
  }

  const flowed: NodeId[] = []
  const unboxed: NodeId[] = []
  const nodes: Record<NodeId, CanvasNode> = {}
  for (const [id, node] of Object.entries(source.nodes)) {
    const parentId = node.parentId
    if (!stacked.has(id) || !parentId) {
      nodes[id] = node
      continue
    }
    const parentMode = source.nodes[parentId]?.layout.mode
    const arranged = parentMode === 'flex' || parentMode === 'grid'
    if (!arranged && (pile.get(parentId) ?? 0) < 2) {
      nodes[id] = node
      continue
    }
    const placeholder = node.type === 'text' && isPlaceholderBox(node.layout)
    flowed.push(id)
    if (placeholder) unboxed.push(id)
    nodes[id] = {
      ...node,
      layout: {
        ...node.layout,
        position: 'flow',
        ...(placeholder
          ? { width: { unit: 'hug' as const }, height: { unit: 'hug' as const } }
          : {}),
      },
    } as CanvasNode
  }

  return { document: { ...source, nodes }, flowed, unboxed }
}
