import { useEffect, useMemo, useState, type DragEvent } from 'react'
import {
  BringToFrontIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ComponentIcon,
  EyeIcon,
  EyeOffIcon,
  FrameIcon,
  GripVerticalIcon,
  LockIcon,
  SendToBackIcon,
  TypeIcon,
  UnlockIcon,
  XIcon,
} from 'lucide-react'
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
  type CanvasDocumentV2,
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

export type DropPosition = 'before' | 'after' | 'inside'

const ORDER_STEP = 1024
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
  document: CanvasDocumentV2,
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
export function resolveDrop(
  document: CanvasDocumentV2,
  draggedId: string,
  targetId: string,
  position: DropPosition,
): { parentId: string | null; order: number } | null {
  const dragged = document.nodes[draggedId]
  const target = document.nodes[targetId]
  if (!dragged || !target || dragged.locked || draggedId === targetId) return null
  if (position === 'inside' && !CONTAINERS.has(target.type)) return null

  const parentId = position === 'inside' ? target.id : target.parentId
  const isRootType = dragged.type === 'page' || dragged.type === 'component'
  if (isRootType !== (parentId === null)) return null
  if (parentId) {
    const parent = document.nodes[parentId]
    if (!parent || !CONTAINERS.has(parent.type)) return null
    // Re-parenting a node under itself would detach the subtree from the tree.
    if (isDescendant(document, parentId, draggedId)) return null
  }

  const siblings = orderedChildren(document, parentId).filter(
    (node) => node.id !== draggedId,
  )
  if (position === 'inside') {
    if (dragged.parentId === parentId && siblings.length === 0) return null
    return { parentId, order: (siblings.at(-1)?.order ?? 0) + ORDER_STEP }
  }

  const index = siblings.findIndex((node) => node.id === targetId)
  if (index === -1) return null
  const insertAt = position === 'before' ? index : index + 1
  if (dragged.parentId === parentId) {
    const currentIndex = siblings.filter((node) => node.order < dragged.order).length
    if (insertAt === currentIndex) return null
  }
  const before = siblings[insertAt - 1]?.order
  const after = siblings[insertAt]?.order
  const order =
    before === undefined && after === undefined
      ? ORDER_STEP
      : before === undefined
        ? after! - ORDER_STEP
        : after === undefined
          ? before + ORDER_STEP
          : (before + after) / 2
  return { parentId, order }
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
  draggedId: string | null
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

export function CanvasV2LayersPanel({
  onReorder,
  canReorder = false,
  onClose,
}: {
  onReorder?: (direction: CanvasReorderDirection) => void
  canReorder?: boolean
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
  const [draggedId, setDraggedId] = useState<string | null>(null)
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
    setDraggedId(null)
    setDropTarget(null)
  }

  const onRowDragOver = (
    event: DragEvent<HTMLDivElement>,
    node: CanvasNode,
  ) => {
    if (!draggedId || readOnly) return
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5
    const position = dropPositionFor(node, ratio)
    if (!resolveDrop(document, draggedId, node.id, position)) {
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
    endDrag()
    if (!draggedId || readOnly || !target || target.id !== node.id) return
    const dragged = document.nodes[draggedId]
    const resolved = resolveDrop(document, draggedId, node.id, target.position)
    if (!dragged || !resolved) return
    transact({
      id: canvasId('tx'),
      label:
        target.position === 'inside'
          ? `Move ${dragged.name} into ${node.name}`
          : `Reorder ${dragged.name}`,
      preconditions: preconditionsForNodeMove(document, dragged.id),
      operations: [
        {
          type: 'node.move',
          id: dragged.id,
          parentId: resolved.parentId,
          order: resolved.order,
        },
      ],
    })
    if (resolved.parentId) {
      setExpanded((current) => new Set(current).add(resolved.parentId!))
    }
  }

  const dragHandlers: LayerDragHandlers = {
    draggedId,
    target: dropTarget,
    onStart: (node, event) => {
      setDraggedId(node.id)
      // Firefox refuses to start a drag without payload on the transfer.
      event.dataTransfer.setData('text/plain', node.id)
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
      className="flex h-full min-h-0 w-full flex-col bg-background"
      aria-label="Layers"
    >
      <header className="shrink-0 border-b px-2 py-1.5">
        <div className="flex h-6 items-center justify-between gap-2">
          <h2 className="ps-1 text-[11px] font-medium text-muted-foreground">
            Layers
          </h2>
          <div className="flex shrink-0 items-center gap-0.5">
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
          className="mt-1 h-6 text-[11px]"
          onChange={(event) => setQuery(event.target.value)}
        />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {search ? (
          matches.length === 0 ? (
            <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
              No matches
            </p>
          ) : (
            matches.map((node) => (
              <button
                key={node.id}
                type="button"
                className={cn(
                  'flex h-7 w-full items-center gap-1.5 px-3 text-left text-[11px]',
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
          <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
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
            selectedKey={selection[0] ? keyFor(selection[0]) : null}
            expanded={expanded}
            onToggle={toggle}
            onSelect={(ref) => session.select([ref])}
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
            <p className="px-3 py-1 text-[11px] text-muted-foreground">
              Components
            </p>
            {components.map((node) => (
              <LayerRow
                key={node.id}
                node={node}
                refValue={{ nodeId: node.id, instancePath: [] }}
                depth={0}
                document={document}
                selectedKey={selection[0] ? keyFor(selection[0]) : null}
                expanded={expanded}
                onToggle={toggle}
                onSelect={(ref) => session.select([ref])}
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
  selectedKey,
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
  selectedKey: string | null
  expanded: Set<string>
  onToggle: (key: string) => void
  onSelect: (ref: NodeRef) => void
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
          'group relative flex h-7 items-center gap-0.5 pe-1 text-[11px]',
          selectedKey === key
            ? 'bg-secondary text-foreground'
            : 'hover:bg-secondary/60',
          drag.draggedId === node.id && 'opacity-40',
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
            onClick={() => onSelect(refValue)}
            onDoubleClick={(event) => {
              // Alt keeps the old isolation gesture; a plain double-click renames.
              if (event.altKey && children.length > 0) {
                onSelect(refValue)
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
                <span className="ms-auto shrink-0 text-[10px] text-muted-foreground">
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
              selectedKey={selectedKey}
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
