import { useRef, useState } from 'react'
import {
  CodeIcon,
  CodeXmlIcon,
  ImageIcon,
  SquareIcon,
  TypeIcon,
} from 'lucide-react'
import type { CanvasElement } from '#/lib/canvas'
import { layerKind, layerKindLabel } from '#/lib/layer-kind'
import { PanelEmpty, PanelShell } from '#/components/panel-shell'
import { cn } from '#/lib/utils'

function LayerKindIcon({ kind }: { kind: ReturnType<typeof layerKind> }) {
  const className = 'size-3.5 shrink-0 opacity-70'
  switch (kind) {
    case 'image':
      return <ImageIcon aria-hidden className={className} />
    case 'text':
      return <TypeIcon aria-hidden className={className} />
    case 'box':
      return <SquareIcon aria-hidden className={className} />
    case 'jsx':
      return <CodeXmlIcon aria-hidden className={className} />
    case 'html':
      return <CodeIcon aria-hidden className={className} />
  }
}

export function LayersPanel({
  elements,
  selectedIds,
  onSelect,
  onReorderList,
  onRename,
  onClose,
}: {
  elements: CanvasElement[]
  selectedIds: string[]
  onSelect: (ids: string[]) => void
  onReorderList: (orderedIds: string[]) => void
  onRename: (id: string, name: string) => void
  onClose?: () => void
}) {
  // top-most layer first
  const display = [...elements].reverse()
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const itemRefs = useRef(new Map<string, HTMLDivElement>())

  const drop = () => {
    if (dragId && overId && dragId !== overId) {
      const ids = display.map((s) => s.id)
      const from = ids.indexOf(dragId)
      const over = ids.indexOf(overId)
      ids.splice(from, 1)
      ids.splice(over + (from <= over ? 1 : 0), 0, dragId)
      onReorderList([...ids].reverse())
    }
    setDragId(null)
    setOverId(null)
  }

  const moveLayer = (id: string, direction: -1 | 1) => {
    const ids = display.map((s) => s.id)
    const from = ids.indexOf(id)
    const to = from + direction
    if (from < 0 || to < 0 || to >= ids.length) return
    ;[ids[from], ids[to]] = [ids[to], ids[from]]
    onReorderList([...ids].reverse())
  }

  return (
    <PanelShell title="Layers" onClose={onClose} bodyClassName="p-1.5">
      {display.length === 0 ? (
        <PanelEmpty
          title="No layers yet"
          description="Draw a shape with the tools, or ask the agent to add something."
        />
      ) : (
        <div role="listbox" aria-label="Layers" aria-multiselectable="true" className="flex flex-col">
          {display.map((s, index) => {
            const isSelected = selectedIds.includes(s.id)
            const kind = layerKind(s)
            return (
              <div
                key={s.id}
                ref={(node) => {
                  if (node) itemRefs.current.set(s.id, node)
                  else itemRefs.current.delete(s.id)
                }}
                role="option"
                aria-selected={isSelected}
                tabIndex={
                  focusId === s.id ||
                  (!focusId && isSelected) ||
                  (!focusId && selectedIds.length === 0 && index === 0)
                    ? 0
                    : -1
                }
                draggable={renamingId !== s.id}
                onDragStart={() => setDragId(s.id)}
                onDragOver={(e) => {
                  e.preventDefault()
                  setOverId(s.id)
                }}
                onDrop={drop}
                onDragEnd={() => {
                  setDragId(null)
                  setOverId(null)
                }}
                onFocus={() => setFocusId(s.id)}
                onClick={(e) => {
                  setFocusId(s.id)
                  if (e.shiftKey || e.metaKey) {
                    onSelect(
                      isSelected ? selectedIds.filter((i) => i !== s.id) : [...selectedIds, s.id],
                    )
                  } else {
                    onSelect([s.id])
                  }
                }}
                onDoubleClick={() => setRenamingId(s.id)}
                onKeyDown={(e) => {
                  if (renamingId === s.id) return
                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault()
                    const direction = e.key === 'ArrowUp' ? -1 : 1
                    if (e.altKey) {
                      moveLayer(s.id, direction)
                      return
                    }
                    const next = display[index + direction]
                    if (!next) return
                    setFocusId(next.id)
                    onSelect(
                      e.shiftKey || e.metaKey
                        ? [...new Set([...selectedIds, next.id])]
                        : [next.id],
                    )
                    requestAnimationFrame(() => itemRefs.current.get(next.id)?.focus())
                    return
                  }
                  if (e.key === 'Enter' || e.key === 'F2') {
                    e.preventDefault()
                    setRenamingId(s.id)
                  }
                }}
                className={cn(
                  'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-xs outline-none',
                  'focus-visible:ring-2 focus-visible:ring-ring/40',
                  isSelected ? 'bg-cx-accent/10 text-cx-accent' : 'hover:bg-secondary',
                  overId === s.id && dragId !== s.id && 'border-t border-cx-accent',
                )}
              >
                <span title={layerKindLabel(kind)} className="flex shrink-0 items-center">
                  <LayerKindIcon kind={kind} />
                </span>
                {renamingId === s.id ? (
                  <input
                    autoFocus
                    aria-label={`Rename ${s.name || 'Element'}`}
                    defaultValue={s.name}
                    className="w-full bg-transparent text-xs outline-none"
                    onBlur={(e) => {
                      onRename(s.id, e.target.value.trim() || 'Element')
                      setRenamingId(null)
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate">{s.name || 'Element'}</span>
                )}
                {s.groupId ? (
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-current opacity-40"
                    title="Grouped"
                    aria-hidden
                  />
                ) : null}
              </div>
            )
          })}
          <p className="px-2 pt-2 text-[10px] text-muted-foreground">
            Drag or Alt↑/Alt↓ to reorder.
          </p>
        </div>
      )}
    </PanelShell>
  )
}
