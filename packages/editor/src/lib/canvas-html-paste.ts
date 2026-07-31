import {
  orderedChildren,
  type CanvasDocument,
  type CanvasNode,
  type ImageNode,
  type NodeId,
  type NodeRef,
  type PageNode,
} from '@loora/canvas/model'

const MAX_FETCHED_IMAGE_BYTES = 5 * 1024 * 1024

export interface PlacedHtmlPaste {
  nodes: CanvasNode[]
  rootIds: NodeId[]
}

export function containingPage(
  document: CanvasDocument,
  nodeId?: NodeId,
): PageNode | null {
  let node = nodeId ? document.nodes[nodeId] : null
  while (node) {
    if (node.type === 'page') return node
    node = node.parentId ? document.nodes[node.parentId] : null
  }
  return null
}

export function containingPageForRef(
  document: CanvasDocument,
  ref?: NodeRef,
) {
  return containingPage(document, ref?.instancePath[0] ?? ref?.nodeId)
}

export function placeHtmlImport(
  current: CanvasDocument,
  imported: CanvasDocument,
  parentId: NodeId,
): PlacedHtmlPaste {
  const parent = current.nodes[parentId]
  const page = orderedChildren(imported, null).find((node) => node.type === 'page')
  if (!parent || !page) return { nodes: [], rootIds: [] }

  const roots = orderedChildren(imported, page.id)
  if (roots.length === 0) return { nodes: [], rootIds: [] }
  const included = new Set<NodeId>()
  const collect = (nodeId: NodeId) => {
    if (included.has(nodeId)) return
    included.add(nodeId)
    for (const child of orderedChildren(imported, nodeId)) collect(child.id)
  }
  roots.forEach((root) => collect(root.id))

  const lastOrder = orderedChildren(current, parentId).at(-1)?.order ?? 0
  const absoluteRoots = roots.filter((root) => root.layout.position === 'absolute')
  const left =
    absoluteRoots.length > 0
      ? Math.min(...absoluteRoots.map((root) => root.layout.x))
      : 0
  const top =
    absoluteRoots.length > 0
      ? Math.min(...absoluteRoots.map((root) => root.layout.y))
      : 0
  const rootIds = new Set(roots.map((root) => root.id))
  const nodes = [...included]
    .map((nodeId) => structuredClone(imported.nodes[nodeId]!))
    .map((node) => {
      if (!rootIds.has(node.id)) return node
      const index = roots.findIndex((root) => root.id === node.id)
      node.parentId = parentId
      node.order = lastOrder + (index + 1) * 1_024
      if (parent.layout.mode === 'absolute') {
        node.layout.position = 'absolute'
        node.layout.x = node.layout.x - left + 48
        node.layout.y = node.layout.y - top + 48
      } else {
        node.layout.position = 'flow'
        node.layout.x = 0
        node.layout.y = 0
      }
      return node
    })

  const depth = (node: CanvasNode) => {
    let value = 0
    let ancestorId = node.parentId
    while (ancestorId && included.has(ancestorId)) {
      value += 1
      ancestorId = imported.nodes[ancestorId]?.parentId ?? null
    }
    return value
  }
  nodes.sort(
    (leftNode, rightNode) =>
      depth(leftNode) - depth(rightNode) ||
      leftNode.order - rightNode.order ||
      leftNode.id.localeCompare(rightNode.id),
  )
  return { nodes, rootIds: roots.map((root) => root.id) }
}

export function importedImageNodes(nodes: CanvasNode[]) {
  return nodes.filter(
    (node): node is ImageNode =>
      node.type === 'image' &&
      !node.src.startsWith('/api/asset/'),
  )
}

function imageName(source: string, fallback: string) {
  if (source.startsWith('data:')) return `${fallback || 'Pasted image'}.png`
  try {
    const name = decodeURIComponent(new URL(source).pathname.split('/').at(-1) || '')
    return name.slice(0, 200) || fallback || 'Pasted image'
  } catch {
    return fallback || 'Pasted image'
  }
}

export async function fetchImageFile(source: string, fallbackName: string) {
  const response = await fetch(source, {
    credentials: 'omit',
    mode: 'cors',
    referrerPolicy: 'no-referrer',
  })
  if (!response.ok) throw new Error(`Image responded ${response.status}`)
  const declaredSize = Number(response.headers.get('content-length') || 0)
  if (declaredSize > MAX_FETCHED_IMAGE_BYTES) {
    throw new Error('Image is larger than 5 MB')
  }
  const blob = await response.blob()
  if (!blob.type.startsWith('image/')) throw new Error('URL did not return an image')
  if (blob.size > MAX_FETCHED_IMAGE_BYTES) {
    throw new Error('Image is larger than 5 MB')
  }
  return new File([blob], imageName(source, fallbackName), { type: blob.type })
}
