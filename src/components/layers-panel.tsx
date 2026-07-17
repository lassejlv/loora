import { useState } from 'react'
import {
  CircleIcon,
  FrameIcon,
  SquareIcon,
  TypeIcon,
  XIcon,
} from 'lucide-react'
import type { Shape } from '#/lib/canvas'
import { renderOrder } from '#/lib/canvas'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'

const TYPE_ICONS = {
  frame: FrameIcon,
  rect: SquareIcon,
  ellipse: CircleIcon,
  text: TypeIcon,
} as const

function layerLabel(s: Shape) {
  if (s.type === 'frame') return s.text ?? 'Frame'
  if (s.type === 'text') return s.text || 'Text'
  return s.type === 'rect' ? 'Rectangle' : 'Ellipse'
}

export function LayersPanel({
  shapes,
  selectedIds,
  onSelect,
  onReorderList,
  onRenameFrame,
  onClose,
}: {
  shapes: Shape[]
  selectedIds: string[]
  onSelect: (ids: string[]) => void
  onReorderList: (orderedIds: string[]) => void
  onRenameFrame: (id: string, name: string) => void
  onClose: () => void
}) {
  // top-most layer first
  const display = [...renderOrder(shapes)].reverse()
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)

  const drop = () => {
    if (dragId && overId && dragId !== overId) {
      const ids = display.map((s) => s.id)
      const from = ids.indexOf(dragId)
      ids.splice(from, 1)
      ids.splice(ids.indexOf(overId) + (from <= ids.indexOf(overId) ? 1 : 0), 0, dragId)
      onReorderList([...ids].reverse())
    }
    setDragId(null)
    setOverId(null)
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-card">
      <header className="flex items-center justify-between border-b px-3 py-2.5">
        <h2 className="text-sm font-semibold">Layers</h2>
        <Button variant="ghost" size="icon-xs" aria-label="Close layers" onClick={onClose}>
          <XIcon data-slot="icon" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {display.length === 0 && (
          <p className="px-2 py-3 text-xs text-muted-foreground">Nothing on the canvas yet.</p>
        )}
        {display.map((s) => {
          const Icon = TYPE_ICONS[s.type]
          const isSelected = selectedIds.includes(s.id)
          return (
            <div
              key={s.id}
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
              onClick={(e) => {
                if (e.shiftKey || e.metaKey) {
                  onSelect(
                    isSelected ? selectedIds.filter((i) => i !== s.id) : [...selectedIds, s.id],
                  )
                } else {
                  onSelect([s.id])
                }
              }}
              onDoubleClick={() => {
                if (s.type === 'frame') setRenamingId(s.id)
              }}
              className={cn(
                'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-xs',
                isSelected ? 'bg-cx-accent/10 text-cx-accent' : 'hover:bg-secondary',
                overId === s.id && dragId !== s.id && 'border-t border-cx-accent',
                s.type === 'frame' && 'font-medium',
              )}
            >
              <Icon className="size-3.5 shrink-0 opacity-70" />
              {renamingId === s.id ? (
                <input
                  autoFocus
                  defaultValue={s.text ?? 'Frame'}
                  className="w-full bg-transparent text-xs outline-none"
                  onBlur={(e) => {
                    onRenameFrame(s.id, e.target.value.trim() || 'Frame')
                    setRenamingId(null)
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="truncate">{layerLabel(s)}</span>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
