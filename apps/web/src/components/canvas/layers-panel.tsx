import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { PanelBottomIcon, PanelRightIcon } from '#/components/icons'
import {
  BringToFrontIcon,
  ComponentIcon,
  PanelLeftIcon,
  PlusIcon,
  SendToBackIcon,
  TypeIcon,
} from '#/components/icons'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  FrameIcon,
  GripVerticalIcon,
  LockIcon,
  UnlockIcon,
  XIcon,
} from '#/components/icons'
import {
  useCanvasDocument,
  useCanvasReadOnly,
  useCanvasSelection,
  useCanvasSession,
  useCanvasTransaction,
} from '@loora/canvas/react'
import {
  canvasId,
  orderedChildren,
  type CanvasDocument,
  type CanvasNode,
  type NodePatch,
  type NodeRef,
} from '@loora/canvas/model'
import {
  preconditionsForNodeMove,
  type CanvasOperation,
} from '@loora/canvas/engine'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { cn } from '#/lib/utils'

export type CanvasReorderDirection = 'forward' | 'front' | 'backward' | 'back'
export type CanvasPanelPosition = 'left' | 'right' | 'bottom'

export type DropPosition = 'before' | 'after' | 'inside'

const ORDER_STEP = 1024
const AUTO_SCROLL_EDGE = 40
const AUTO_SCROLL_MAX = 14
const CONTAINERS = new Set(['page', 'component', 'frame', 'group'])

/**
 * Where a pointer sitting `ratio` down a row wants to drop. Containers keep a
 * middle band that means "put it inside"; everything else only reorders.
 */
export function dropPositionFor(node: CanvasNode, ratio: number): DropPosition {
  if (!CONTAINERS.has(node.type)) return ratio < 0.5 ? 'before' : 'after'
  if (ratio < 0.28) return 'before'
  if (ratio > 0.72) return 'after'
  return 'inside'
}

function isDescendant(
  document: CanvasDocument,
  candidateId: string | null,
  ancestorId: string,
) {
  let current = candidateId
  while (current) {
    if (current === ancestorId) return true
    current = document.nodes[current]?.parentId ?? null
  }
  return false
}

/**
 * The parent and order a drop resolves to, or null when the move is not legal:
 * dropping a node into itself or its own subtree, moving a Page off the
 * document root, dropping into something that cannot hold children, or a drag
 * that would leave the tree exactly as it was.
 */
export interface DropPlan {
  parentId: string | null
  moves: { id: string; order: number }[]
}

/** Selected ids that do not already travel inside another selected subtree. */
export function dragRoots(document: CanvasDocument, ids: string[]) {
  const wanted = ids.filter((id) => document.nodes[id])
  const selected = new Set(wanted)
  return wanted.filter((id) => {
    let parentId = document.nodes[id]?.parentId ?? null
    while (parentId) {
      if (selected.has(parentId)) return false
      parentId = document.nodes[parentId]?.parentId ?? null
    }
    return true
  })
}

/** Orders that place `count` nodes between two neighbours, or past the last one. */
function ordersBetween(before: number | undefined, after: number | undefined, count: number) {
  if (before === undefined && after === undefined) {
    return Array.from({ length: count }, (_, index) => (index + 1) * ORDER_STEP)
  }
  if (after === undefined) {
    return Array.from({ length: count }, (_, index) => before! + (index + 1) * ORDER_STEP)
  }
  if (before === undefined) {
    return Array.from(
      { length: count },
      (_, index) => after - (count - index) * ORDER_STEP,
    )
  }
  const step = (after - before) / (count + 1)
  return Array.from({ length: count }, (_, index) => before + step * (index + 1))
}

export function resolveDrop(
  document: CanvasDocument,
  draggedIds: string[],
  targetId: string,
  position: DropPosition,
): DropPlan | null {
  const target = document.nodes[targetId]
  const dragging = dragRoots(document, draggedIds)
  if (!target || dragging.length === 0 || dragging.includes(targetId)) return null
  if (position === 'inside' && !CONTAINERS.has(target.type)) return null

  const parentId = position === 'inside' ? target.id : target.parentId
  if (parentId) {
    const parent = document.nodes[parentId]
    if (!parent || !CONTAINERS.has(parent.type)) return null
  }
  for (const id of dragging) {
    const dragged = document.nodes[id]!
    if (dragged.locked) return null
    const isRootType = dragged.type === 'page' || dragged.type === 'component'
    if (isRootType !== (parentId === null)) return null
    // Re-parenting a node under itself would detach the subtree from the tree.
    if (parentId && isDescendant(document, parentId, id)) return null
  }

  // Dragged nodes keep their relative order, wherever they came from.
  const moving = new Set(dragging)
  const ordered = dragging
    .map((id) => document.nodes[id]!)
    .sort((left, right) => left.order - right.order)
  const siblings = orderedChildren(document, parentId).filter(
    (node) => !moving.has(node.id),
  )

  if (position === 'inside') {
    const unchanged =
      siblings.length === 0 && ordered.every((node) => node.parentId === parentId)
    if (unchanged) return null
    const orders = ordersBetween(siblings.at(-1)?.order, undefined, ordered.length)
    return {
      parentId,
      moves: ordered.map((node, index) => ({ id: node.id, order: orders[index]! })),
    }
  }

  const index = siblings.findIndex((node) => node.id === targetId)
  if (index === -1) return null
  const insertAt = position === 'before' ? index : index + 1
  const alreadyThere =
    ordered.every((node) => node.parentId === parentId) &&
    insertAt ===
      siblings.filter((node) => node.order < ordered[0]!.order).length &&
    ordered.every(
      (node, offset) =>
        offset === 0 ||
        // Contiguous already: nothing sits between the dragged nodes.
        !siblings.some(
          (sibling) =>
            sibling.order > ordered[offset - 1]!.order && sibling.order < node.order,
        ),
    )
  if (alreadyThere) return null

  const orders = ordersBetween(
    siblings[insertAt - 1]?.order,
    siblings[insertAt]?.order,
    ordered.length,
  )
  return {
    parentId,
    moves: ordered.map((node, index) => ({ id: node.id, order: orders[index]! })),
  }
}

function keyFor(ref: NodeRef) {
  return ref.instancePath.length > 0
    ? `${ref.instancePath.join('/')}:${ref.nodeId}`
    : ref.nodeId
}

function nodeIcon(node: CanvasNode) {
  if (node.type === 'text') return TypeIcon
  if (node.type === 'component' || node.type === 'instance') return ComponentIcon
  return FrameIcon
}

interface LayerDragHandlers {
  draggedIds: string[]
  target: { id: string; position: DropPosition } | null
  onStart: (node: CanvasNode, event: DragEvent<HTMLDivElement>) => void
  onEnd: () => void
  onOver: (event: DragEvent<HTMLDivElement>, node: CanvasNode) => void
  onLeave: (node: CanvasNode) => void
  onDrop: (event: DragEvent<HTMLDivElement>, node: CanvasNode) => void
}

function patchOperation(ref: NodeRef, patch: NodePatch): CanvasOperation {
  const instanceId = ref.instancePath.at(-1)
  return instanceId
    ? {
        type: 'instance.patchOverride',
        id: instanceId,
        targetId: ref.nodeId,
        patch,
      }
    : { type: 'node.patch', id: ref.nodeId, patch }
}

export function CanvasLayersPanel({
  onReorder,
  canReorder = false,
  onAddPage,
  position = 'right',
  onPositionChange,
  onClose,
}: {
  onReorder?: (direction: CanvasReorderDirection) => void
  canReorder?: boolean
  onAddPage?: () => void
  position?: CanvasPanelPosition
  onPositionChange?: (position: CanvasPanelPosition) => void
  onClose?: () => void
}) {
  const document = useCanvasDocument()
  const selection = useCanvasSelection()
  const session = useCanvasSession()
  const transact = useCanvasTransaction()
  const readOnly = useCanvasReadOnly()
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(Object.values(document.nodes).filter((node) => node.type === 'page').map((node) => node.id)),
  )
  const [draggedIds, setDraggedIds] = useState<string[]>([])
  const listRef = useRef<HTMLDivElement | null>(null)
  const autoScroll = useRef(0)
  const scrollFrame = useRef<number | null>(null)
  const [dropTarget, setDropTarget] = useState<{
    id: string
    position: DropPosition
  } | null>(null)
  const [query, setQuery] = useState('')
  const [renamingKey, setRenamingKey] = useState<string | null>(null)
  const search = query.trim().toLowerCase()
  const matches = useMemo(
    () =>
      search
        ? Object.values(document.nodes).filter((node) =>
            node.name.toLowerCase().includes(search),
          )
        : [],
    [document, search],
  )
  const roots = useMemo(
    () => orderedChildren(document, null).filter((node) => node.type === 'page'),
    [document],
  )
  const components = useMemo(
    () => orderedChildren(document, null).filter((node) => node.type === 'component'),
    [document],
  )

  const selectedKeys = useMemo(
    () => new Set(selection.map((ref) => keyFor(ref))),
    [selection],
  )

  /** Cmd or Ctrl adds to the selection, so a group can be dragged at once. */
  const selectLayer = (ref: NodeRef, additive: boolean) => {
    if (!additive) {
      session.select([ref])
      return
    }
    const key = keyFor(ref)
    const next = selection.filter((current) => keyFor(current) !== key)
    session.select(next.length === selection.length ? [...selection, ref] : next)
  }

  const toggle = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Hovering a collapsed container opens it, so a drag can reach nested layers.
  useEffect(() => {
    if (!dropTarget || dropTarget.position !== 'inside') return
    if (expanded.has(dropTarget.id)) return
    const timer = window.setTimeout(() => {
      setExpanded((current) => new Set(current).add(dropTarget.id))
    }, 600)
    return () => window.clearTimeout(timer)
  }, [dropTarget, expanded])

  const endDrag = () => {
    setDraggedIds([])
    setDropTarget(null)
    autoScroll.current = 0
  }

  /**
   * Dragging past either edge of the list scrolls it, so a layer can be moved
   * somewhere the drag started too far away to reach.
   */
  const runAutoScroll = () => {
    scrollFrame.current = null
    const list = listRef.current
    if (!list || autoScroll.current === 0) return
    list.scrollTop += autoScroll.current
    scrollFrame.current = requestAnimationFrame(runAutoScroll)
  }

  const onListDragOver = (event: DragEvent<HTMLDivElement>) => {
    const list = listRef.current
    if (!list || draggedIds.length === 0) return
    const rect = list.getBoundingClientRect()
    const above = event.clientY - rect.top
    const below = rect.bottom - event.clientY
    const speed = (distance: number) =>
      Math.ceil(((AUTO_SCROLL_EDGE - distance) / AUTO_SCROLL_EDGE) * AUTO_SCROLL_MAX)
    autoScroll.current =
      above < AUTO_SCROLL_EDGE
        ? -speed(Math.max(0, above))
        : below < AUTO_SCROLL_EDGE
          ? speed(Math.max(0, below))
          : 0
    if (autoScroll.current !== 0 && scrollFrame.current === null) {
      scrollFrame.current = requestAnimationFrame(runAutoScroll)
    }
  }

  const onRowDragOver = (
    event: DragEvent<HTMLDivElement>,
    node: CanvasNode,
  ) => {
    if (draggedIds.length === 0 || readOnly) return
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5
    const position = dropPositionFor(node, ratio)
    if (!resolveDrop(document, draggedIds, node.id, position)) {
      // No drop effect, so the row reads as rejected instead of silently eating
      // the drag.
      setDropTarget(null)
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget((current) =>
      current?.id === node.id && current.position === position
        ? current
        : { id: node.id, position },
    )
  }

  const onRowDrop = (event: DragEvent<HTMLDivElement>, node: CanvasNode) => {
    event.preventDefault()
    const target = dropTarget
    const dragging = draggedIds
    endDrag()
    if (dragging.length === 0 || readOnly || !target || target.id !== node.id) return
    const plan = resolveDrop(document, dragging, node.id, target.position)
    if (!plan) return
    const first = document.nodes[plan.moves[0]!.id]
    transact({
      id: canvasId('tx'),
      label:
        plan.moves.length > 1
          ? `Move ${plan.moves.length} layers`
          : target.position === 'inside'
            ? `Move ${first?.name ?? 'layer'} into ${node.name}`
            : `Reorder ${first?.name ?? 'layer'}`,
      preconditions: plan.moves.flatMap((move) =>
        preconditionsForNodeMove(document, move.id),
      ),
      operations: plan.moves.map((move) => ({
        type: 'node.move' as const,
        id: move.id,
        parentId: plan.parentId,
        order: move.order,
      })),
    })
    if (plan.parentId) {
      setExpanded((current) => new Set(current).add(plan.parentId!))
    }
  }

  const dragHandlers: LayerDragHandlers = {
    draggedIds,
    target: dropTarget,
    onStart: (node, event) => {
      // Grabbing a row that is part of the selection drags the whole selection.
      const selectedIds = selection
        .filter((ref) => ref.instancePath.length === 0)
        .map((ref) => ref.nodeId)
      const ids = dragRoots(
        document,
        selectedIds.includes(node.id) ? selectedIds : [node.id],
      )
      setDraggedIds(ids)
      // Firefox refuses to start a drag without payload on the transfer.
      event.dataTransfer.setData('text/plain', ids.join(','))
      event.dataTransfer.effectAllowed = 'move'
    },
    onEnd: endDrag,
    onOver: onRowDragOver,
    onLeave: (node) =>
      setDropTarget((current) => (current?.id === node.id ? null : current)),
    onDrop: onRowDrop,
  }

  return (
    <aside
      className="flex h-full min-h-0 w-full flex-col bg-transparent"
      aria-label="Layers"
    >
      <header className="shrink-0 border-b px-2 py-1.5">
        <div className="flex h-6 items-center justify-between gap-2">
          <h2 className="ps-1 text-xs font-medium text-muted-foreground">
            Layers
          </h2>
          <div className="flex shrink-0 items-center gap-0.5">
            {onAddPage ? (
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="New page"
                title="New page"
                disabled={readOnly}
                onClick={onAddPage}
              >
                <PlusIcon />
              </Button>
            ) : null}
            {onReorder ? (
              <>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Bring forward (], shift-click for front)"
                  title="Bring forward (], shift-click for front)"
                  disabled={!canReorder}
                  onClick={(event) =>
                    onReorder(event.shiftKey ? 'front' : 'forward')
                  }
                >
                  <BringToFrontIcon />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Send backward ([, shift-click for back)"
                  title="Send backward ([, shift-click for back)"
                  disabled={!canReorder}
                  onClick={(event) =>
                    onReorder(event.shiftKey ? 'back' : 'backward')
                  }
                >
                  <SendToBackIcon />
                </Button>
              </>
            ) : null}
            {onPositionChange ? (
              <>
                <Button
                  size="icon-xs"
                  variant={position === 'left' ? 'secondary' : 'ghost'}
                  aria-label="Move layers panel to left"
                  aria-pressed={position === 'left'}
                  title="Dock left"
                  onClick={() => onPositionChange('left')}
                >
                  <PanelLeftIcon />
                </Button>
                <Button
                  size="icon-xs"
                  variant={position === 'bottom' ? 'secondary' : 'ghost'}
                  aria-label="Move layers panel to bottom"
                  aria-pressed={position === 'bottom'}
                  title="Dock bottom"
                  onClick={() => onPositionChange('bottom')}
                >
                  <PanelBottomIcon />
                </Button>
                <Button
                  size="icon-xs"
                  variant={position === 'right' ? 'secondary' : 'ghost'}
                  aria-label="Move layers panel to right"
                  aria-pressed={position === 'right'}
                  title="Dock right"
                  onClick={() => onPositionChange('right')}
                >
                  <PanelRightIcon />
                </Button>
              </>
            ) : null}
            {onClose ? (
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Close layers panel"
                onClick={onClose}
              >
                <XIcon />
              </Button>
            ) : null}
          </div>
        </div>
        <Input
          value={query}
          aria-label="Search layers"
          placeholder="Search layers"
          className="mt-1 h-6 text-xs"
          onChange={(event) => setQuery(event.target.value)}
        />
      </header>
      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto py-1"
        onDragOver={onListDragOver}
        onDragLeave={() => {
          autoScroll.current = 0
        }}
        onDrop={() => {
          autoScroll.current = 0
        }}
      >
        {search ? (
          matches.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              No matches
            </p>
          ) : (
            matches.map((node) => (
              <button
                key={node.id}
                type="button"
                className={cn(
                  'flex h-7 w-full items-center gap-1.5 px-3 text-left text-xs',
                  selection[0]?.nodeId === node.id
                    ? 'bg-secondary text-foreground'
                    : 'hover:bg-secondary/60',
                )}
                onClick={() =>
                  session.select([{ nodeId: node.id, instancePath: [] }])
                }
              >
                {(() => {
                  const Icon = nodeIcon(node)
                  return <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                })()}
                <span className="truncate">{node.name}</span>
              </button>
            ))
          )
        ) : roots.length === 0 && components.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No layers yet
          </p>
        ) : null}
        {search ? null : roots.map((node) => (
          <LayerRow
            key={node.id}
            node={node}
            refValue={{ nodeId: node.id, instancePath: [] }}
            depth={0}
            document={document}
            selectedKeys={selectedKeys}
            expanded={expanded}
            onToggle={toggle}
            onSelect={selectLayer}
            onPatch={(ref, patch) =>
              !readOnly && transact({
                id: canvasId('tx'),
                label: `Update ${document.nodes[ref.nodeId]?.name ?? 'node'}`,
                operations: [patchOperation(ref, patch)],
              })
            }
            drag={dragHandlers}
            readOnly={readOnly}
            renamingKey={renamingKey}
            onRenamingKeyChange={setRenamingKey}
          />
        ))}
        {!search && components.length > 0 ? (
          <section className="mt-2 border-t pt-1">
            <p className="px-3 py-1 text-xs text-muted-foreground">
              Components
            </p>
            {components.map((node) => (
              <LayerRow
                key={node.id}
                node={node}
                refValue={{ nodeId: node.id, instancePath: [] }}
                depth={0}
                document={document}
                selectedKeys={selectedKeys}
                expanded={expanded}
                onToggle={toggle}
                onSelect={selectLayer}
                onPatch={(ref, patch) =>
                  !readOnly && transact({
                    id: canvasId('tx'),
                    label: `Update ${document.nodes[ref.nodeId]?.name ?? 'node'}`,
                    operations: [patchOperation(ref, patch)],
                  })
                }
                drag={dragHandlers}
                readOnly={readOnly}
                renamingKey={renamingKey}
                onRenamingKeyChange={setRenamingKey}
              />
            ))}
          </section>
        ) : null}
      </div>
    </aside>
  )
}

function LayerRow({
  node,
  refValue,
  depth,
  document,
  selectedKeys,
  expanded,
  onToggle,
  onSelect,
  onPatch,
  drag,
  readOnly,
  renamingKey,
  onRenamingKeyChange,
}: {
  node: CanvasNode
  refValue: NodeRef
  depth: number
  document: ReturnType<typeof useCanvasDocument>
  selectedKeys: Set<string>
  expanded: Set<string>
  onToggle: (key: string) => void
  onSelect: (ref: NodeRef, additive: boolean) => void
  onPatch: (ref: NodeRef, patch: NodePatch) => void
  drag: LayerDragHandlers
  readOnly: boolean
  renamingKey: string | null
  onRenamingKeyChange: (key: string | null) => void
}) {
  const session = useCanvasSession()
  const instance =
    node.type === 'instance' ? node : null
  const component =
    instance ? document.nodes[instance.componentId] : null
  const childParentId =
    component?.type === 'component' ? component.id : node.id
  const children = ['page', 'component', 'frame', 'group', 'instance'].includes(node.type)
    ? orderedChildren(document, childParentId)
    : []
  const childPath =
    instance ? [...refValue.instancePath, instance.id] : refValue.instancePath
  const key = keyFor(refValue)
  const open = expanded.has(key)
  const Icon = nodeIcon(node)
  const sourceDraggable = refValue.instancePath.length === 0
  const dropTarget =
    drag.target?.id === node.id && sourceDraggable ? drag.target.position : null
  const dropEdge = dropTarget === 'inside' ? null : dropTarget
  const dropInside = dropTarget === 'inside'
  return (
    <>
      <div
        className={cn(
          'group relative flex h-7 items-center gap-0.5 pe-1 text-xs',
          selectedKeys.has(key)
            ? 'bg-secondary text-foreground'
            : 'hover:bg-secondary/60',
          drag.draggedIds.includes(node.id) && 'opacity-40',
          dropInside && 'bg-cx-accent/12 ring-1 ring-cx-accent ring-inset',
        )}
        style={{ paddingInlineStart: 4 + depth * 14 }}
        draggable={sourceDraggable && !readOnly}
        onDragStart={(event) => drag.onStart(node, event)}
        onDragEnd={drag.onEnd}
        onDragOver={(event) => sourceDraggable && drag.onOver(event, node)}
        onDragLeave={() => drag.onLeave(node)}
        onDrop={(event) => drag.onDrop(event, node)}
      >
        {dropEdge ? (
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-x-0 h-0.5 bg-cx-accent',
              dropEdge === 'before' ? 'top-0' : 'bottom-0',
            )}
          />
        ) : null}
        {sourceDraggable ? (
          <GripVerticalIcon className="size-3 shrink-0 cursor-grab opacity-0 group-hover:opacity-50" />
        ) : (
          <span className="w-3" />
        )}
        {children.length > 0 ? (
          <button
            type="button"
            className="grid size-5 shrink-0 place-items-center rounded hover:bg-secondary"
            aria-label={open ? 'Collapse layer' : 'Expand layer'}
            onClick={() => onToggle(key)}
          >
            {open ? <ChevronDownIcon className="size-3" /> : <ChevronRightIcon className="size-3" />}
          </button>
        ) : (
          // A leaf still needs the indent, but not a hoverable button that does nothing.
          <span className="size-5 shrink-0" />
        )}
        {renamingKey === key ? (
          <input
            autoFocus
            defaultValue={node.name}
            aria-label={`Rename ${node.name}`}
            className="min-w-0 flex-1 rounded border bg-background px-1 py-0.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(event) => event.stopPropagation()}
            onBlur={(event) => {
              const name = event.currentTarget.value.trim()
              if (name && name !== node.name) onPatch(refValue, { name })
              onRenamingKeyChange(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                event.currentTarget.value = node.name
                event.currentTarget.blur()
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(event) => onSelect(refValue, event.metaKey || event.ctrlKey)}
            onDoubleClick={(event) => {
              // Alt keeps the old isolation gesture; a plain double-click renames.
              if (event.altKey && children.length > 0) {
                onSelect(refValue, false)
                session.setEditingRoot(refValue)
                onToggle(key)
                return
              }
              if (!readOnly) onRenamingKeyChange(key)
            }}
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{node.name}</span>
            {node.type === 'instance' ? (
                <span className="ms-auto shrink-0 text-[11px] text-muted-foreground">
                Instance
              </span>
            ) : null}
          </button>
        )}
        <button
          type="button"
          className="grid size-6 shrink-0 place-items-center rounded opacity-0 hover:bg-secondary group-hover:opacity-100"
          aria-label={node.hidden ? 'Show layer' : 'Hide layer'}
          disabled={readOnly}
          onClick={() => onPatch(refValue, { hidden: !node.hidden })}
        >
          {node.hidden ? <EyeOffIcon className="size-3" /> : <EyeIcon className="size-3" />}
        </button>
        <button
          type="button"
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded hover:bg-secondary',
            !node.locked && 'opacity-0 group-hover:opacity-100',
          )}
          aria-label={node.locked ? 'Unlock layer' : 'Lock layer'}
          disabled={readOnly}
          onClick={() => onPatch(refValue, { locked: !node.locked })}
        >
          {node.locked ? <LockIcon className="size-3" /> : <UnlockIcon className="size-3" />}
        </button>
      </div>
      {open
        ? children.map((child) => (
            <LayerRow
              key={`${childPath.join('/')}:${child.id}`}
              node={child}
              refValue={{ nodeId: child.id, instancePath: childPath }}
              depth={depth + 1}
              document={document}
              selectedKeys={selectedKeys}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              onPatch={onPatch}
              drag={drag}
              readOnly={readOnly}
              renamingKey={renamingKey}
              onRenamingKeyChange={onRenamingKeyChange}
            />
          ))
        : null}
    </>
  )
}
