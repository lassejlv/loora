import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronRightIcon,
  CodeIcon,
  CodeXmlIcon,
  EyeIcon,
  EyeOffIcon,
  FolderIcon,
  ImageIcon,
  LockIcon,
  SquareIcon,
  TypeIcon,
  UnlockIcon,
} from 'lucide-react'
import type { CanvasElement } from '#/lib/canvas'
import { layerKind, layerKindLabel } from '#/lib/layer-kind'
import {
  buildLayerRows,
  groupLabel,
  reorderRows,
  reorderWithinGroup,
  rowHidden,
  rowIds,
  rowKey,
  rowLocked,
  rowMatches,
  type LayerRow,
} from '#/lib/layer-tree'
import { PanelEmpty, PanelShell } from '#/components/panel-shell'
import { Input } from '#/components/ui/input'
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '#/components/ui/context-menu'
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

export interface LayersPanelProps {
  elements: CanvasElement[]
  selectedIds: string[]
  onSelect: (ids: string[]) => void
  onReorderList: (orderedIds: string[]) => void
  onRename: (id: string, name: string) => void
  /** Applies hidden/locked to a whole row at once (a group toggles as one). */
  onSetFlags: (ids: string[], patch: { hidden?: boolean; locked?: boolean }) => void
  onDuplicate: (ids: string[]) => void
  onDelete: (ids: string[]) => void
  onGroup: (ids: string[]) => void
  onUngroup: (ids: string[]) => void
  onRaise: (ids: string[]) => void
  onLower: (ids: string[]) => void
  /** Drives the canvas hover outline; empty array clears it. */
  onHover?: (ids: string[]) => void
  onClose?: () => void
}

type DragState =
  | { scope: 'row'; key: string }
  | { scope: 'child'; groupId: string; id: string }
  | null

export const LayersPanel = memo(function LayersPanel({
  elements,
  selectedIds,
  onSelect,
  onReorderList,
  onRename,
  onSetFlags,
  onDuplicate,
  onDelete,
  onGroup,
  onUngroup,
  onRaise,
  onLower,
  onHover,
  onClose,
}: LayersPanelProps) {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [drag, setDrag] = useState<DragState>(null)
  const [overKey, setOverKey] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const itemRefs = useRef(new Map<string, HTMLDivElement>())

  const rows = useMemo(() => buildLayerRows(elements), [elements])
  const visibleRows = useMemo(() => rows.filter((row) => rowMatches(row, query)), [rows, query])
  // Searching flattens groups open: a match hidden inside a collapsed group
  // would otherwise look like no result at all.
  const searching = query.trim().length > 0
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  // Keep the selection visible when it changes on the canvas.
  useEffect(() => {
    const first = selectedIds[0]
    if (!first) return
    // Optional call: jsdom (and older Safari for a smooth block) has no scrollIntoView.
    itemRefs.current.get(first)?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedIds])

  const flatKeys = useMemo(() => {
    const keys: string[] = []
    for (const row of visibleRows) {
      keys.push(rowKey(row))
      if (row.kind === 'group' && (searching || !collapsed.has(row.groupId))) {
        for (const member of row.members) keys.push(`element:${member.id}`)
      }
    }
    return keys
  }, [visibleRows, collapsed, searching])

  const selectRow = (row: LayerRow, event: { shiftKey: boolean; metaKey: boolean }) => {
    const ids = rowIds(row)
    if (event.shiftKey || event.metaKey) {
      const alreadyIn = ids.every((id) => selectedSet.has(id))
      onSelect(
        alreadyIn
          ? selectedIds.filter((id) => !ids.includes(id))
          : [...new Set([...selectedIds, ...ids])],
      )
      return
    }
    onSelect(ids)
  }

  const dropOnRow = (targetKey: string) => {
    if (!drag) return
    if (drag.scope === 'row' && drag.key !== targetKey) {
      onReorderList(reorderRows(rows, drag.key, targetKey))
    }
    setDrag(null)
    setOverKey(null)
  }

  const dropOnChild = (groupId: string, targetId: string) => {
    if (drag?.scope === 'child' && drag.groupId === groupId && drag.id !== targetId) {
      onReorderList(reorderWithinGroup(rows, groupId, drag.id, targetId))
    }
    setDrag(null)
    setOverKey(null)
  }

  const moveFocus = (key: string, direction: -1 | 1) => {
    const index = flatKeys.indexOf(key)
    const next = flatKeys[index + direction]
    if (!next) return
    setFocusKey(next)
    requestAnimationFrame(() => itemRefs.current.get(next.replace(/^element:/, ''))?.focus())
  }

  const body = (
    <>
      <div className="sticky top-0 z-10 bg-card/95 px-2 pt-2 pb-1.5 backdrop-blur-sm">
        <Input
          size="sm"
          value={query}
          placeholder="Search layers"
          aria-label="Search layers"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {rows.length === 0 ? (
        <PanelEmpty
          title="No layers yet"
          description="Draw a shape with the tools, or ask the agent to add something."
        />
      ) : visibleRows.length === 0 ? (
        <PanelEmpty title="No matches" description={`Nothing is named like “${query.trim()}”.`} />
      ) : (
        <div
          role="tree"
          aria-label="Layers"
          aria-multiselectable="true"
          className="flex flex-col px-1.5 pb-2"
          onPointerLeave={() => onHover?.([])}
        >
          {visibleRows.map((row) => {
            const key = rowKey(row)
            const ids = rowIds(row)
            const expanded = searching || !collapsed.has(row.kind === 'group' ? row.groupId : '')
            return (
              <div key={key}>
                <LayerRowView
                  row={row}
                  rowKeyValue={key}
                  depth={0}
                  expanded={expanded}
                  selected={ids.every((id) => selectedSet.has(id))}
                  focused={focusKey === key}
                  dropTarget={overKey === key && drag?.scope === 'row' && drag.key !== key}
                  renaming={row.kind === 'element' && renamingId === row.element.id}
                  registerRef={itemRefs}
                  onToggleExpand={
                    row.kind === 'group'
                      ? () =>
                          setCollapsed((current) => {
                            const next = new Set(current)
                            if (next.has(row.groupId)) next.delete(row.groupId)
                            else next.add(row.groupId)
                            return next
                          })
                      : undefined
                  }
                  onSelect={(event) => selectRow(row, event)}
                  onStartRename={
                    row.kind === 'element' ? () => setRenamingId(row.element.id) : undefined
                  }
                  onCommitRename={(name) => {
                    if (row.kind === 'element') onRename(row.element.id, name)
                    setRenamingId(null)
                  }}
                  onHover={() => onHover?.(ids)}
                  onDragStart={() => setDrag({ scope: 'row', key })}
                  onDragOver={() => setOverKey(key)}
                  onDrop={() => dropOnRow(key)}
                  onDragEnd={() => {
                    setDrag(null)
                    setOverKey(null)
                  }}
                  onFocusRow={() => setFocusKey(key)}
                  onArrow={(direction, alt) => {
                    if (alt) {
                      const index = visibleRows.indexOf(row)
                      const neighbour = visibleRows[index + direction]
                      if (neighbour) onReorderList(reorderRows(rows, key, rowKey(neighbour)))
                      return
                    }
                    moveFocus(key, direction)
                  }}
                  menu={
                    <RowMenu
                      ids={ids}
                      elements={elements}
                      onSetFlags={onSetFlags}
                      onDuplicate={onDuplicate}
                      onDelete={onDelete}
                      onGroup={onGroup}
                      onUngroup={onUngroup}
                      onRaise={onRaise}
                      onLower={onLower}
                      onRename={
                        row.kind === 'element' ? () => setRenamingId(row.element.id) : undefined
                      }
                    />
                  }
                  onToggleHidden={() => onSetFlags(ids, { hidden: !rowHidden(row) })}
                  onToggleLocked={() => onSetFlags(ids, { locked: !rowLocked(row) })}
                />

                {row.kind === 'group' && expanded
                  ? row.members.map((member) => {
                      const childRow: LayerRow = { kind: 'element', element: member }
                      const childKey = `element:${member.id}`
                      return (
                        <LayerRowView
                          key={childKey}
                          row={childRow}
                          rowKeyValue={childKey}
                          depth={1}
                          expanded
                          selected={selectedSet.has(member.id)}
                          focused={focusKey === childKey}
                          dropTarget={
                            overKey === childKey &&
                            drag?.scope === 'child' &&
                            drag.id !== member.id
                          }
                          renaming={renamingId === member.id}
                          registerRef={itemRefs}
                          onSelect={(event) => selectRow(childRow, event)}
                          onStartRename={() => setRenamingId(member.id)}
                          onCommitRename={(name) => {
                            onRename(member.id, name)
                            setRenamingId(null)
                          }}
                          onHover={() => onHover?.([member.id])}
                          onDragStart={() =>
                            setDrag({ scope: 'child', groupId: row.groupId, id: member.id })
                          }
                          onDragOver={() => setOverKey(childKey)}
                          onDrop={() => dropOnChild(row.groupId, member.id)}
                          onDragEnd={() => {
                            setDrag(null)
                            setOverKey(null)
                          }}
                          onFocusRow={() => setFocusKey(childKey)}
                          onArrow={(direction) => moveFocus(childKey, direction)}
                          menu={
                            <RowMenu
                              ids={[member.id]}
                              elements={elements}
                              onSetFlags={onSetFlags}
                              onDuplicate={onDuplicate}
                              onDelete={onDelete}
                              onGroup={onGroup}
                              onUngroup={onUngroup}
                              onRaise={onRaise}
                              onLower={onLower}
                              onRename={() => setRenamingId(member.id)}
                            />
                          }
                          onToggleHidden={() =>
                            onSetFlags([member.id], { hidden: member.hidden !== true })
                          }
                          onToggleLocked={() =>
                            onSetFlags([member.id], { locked: member.locked !== true })
                          }
                        />
                      )
                    })
                  : null}
              </div>
            )
          })}
          <p className="px-2 pt-2 text-[10px] text-muted-foreground">
            Drag or Alt↑/Alt↓ to reorder · right-click for more.
          </p>
        </div>
      )}
    </>
  )

  return (
    <PanelShell title="Layers" onClose={onClose} bodyClassName="p-0">
      {body}
    </PanelShell>
  )
})

function LayerRowView({
  row,
  rowKeyValue,
  depth,
  expanded,
  selected,
  focused,
  dropTarget,
  renaming,
  registerRef,
  menu,
  onToggleExpand,
  onSelect,
  onStartRename,
  onCommitRename,
  onHover,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onFocusRow,
  onArrow,
  onToggleHidden,
  onToggleLocked,
}: {
  row: LayerRow
  rowKeyValue: string
  depth: number
  expanded: boolean
  selected: boolean
  focused: boolean
  dropTarget: boolean
  renaming: boolean
  registerRef: React.RefObject<Map<string, HTMLDivElement>>
  menu: React.ReactNode
  onToggleExpand?: () => void
  onSelect: (event: { shiftKey: boolean; metaKey: boolean }) => void
  onStartRename?: () => void
  onCommitRename: (name: string) => void
  onHover: () => void
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onDragEnd: () => void
  onFocusRow: () => void
  onArrow: (direction: -1 | 1, alt: boolean) => void
  onToggleHidden: () => void
  onToggleLocked: () => void
}) {
  const hidden = rowHidden(row)
  const locked = rowLocked(row)
  const label = row.kind === 'group' ? groupLabel(row) : row.element.name || 'Element'
  const refKey = row.kind === 'group' ? rowKeyValue : row.element.id

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            ref={(node: HTMLDivElement | null) => {
              if (node) registerRef.current.set(refKey, node)
              else registerRef.current.delete(refKey)
            }}
            role="treeitem"
            aria-selected={selected}
            aria-expanded={row.kind === 'group' ? expanded : undefined}
            tabIndex={focused || selected ? 0 : -1}
            draggable={!renaming}
            onDragStart={onDragStart}
            onDragOver={(event: React.DragEvent) => {
              event.preventDefault()
              onDragOver()
            }}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
            onPointerEnter={onHover}
            onFocus={onFocusRow}
            onClick={(event: React.MouseEvent) => {
              onFocusRow()
              onSelect({ shiftKey: event.shiftKey, metaKey: event.metaKey })
            }}
            onDoubleClick={() => onStartRename?.()}
            onKeyDown={(event: React.KeyboardEvent) => {
              if (renaming) return
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault()
                onArrow(event.key === 'ArrowUp' ? -1 : 1, event.altKey)
                return
              }
              if (event.key === 'ArrowRight' && row.kind === 'group' && !expanded) onToggleExpand?.()
              if (event.key === 'ArrowLeft' && row.kind === 'group' && expanded) onToggleExpand?.()
              if (event.key === 'Enter' || event.key === 'F2') {
                event.preventDefault()
                onStartRename?.()
              }
            }}
            className={cn(
              'group/layer flex cursor-default items-center gap-1.5 rounded-md py-1.5 pe-1 text-xs outline-none',
              'focus-visible:ring-2 focus-visible:ring-ring/40',
              selected ? 'bg-cx-accent/10 text-cx-accent' : 'hover:bg-secondary',
              hidden && 'opacity-45',
              dropTarget && 'border-t border-cx-accent',
            )}
            style={{ paddingInlineStart: `${0.5 + depth * 0.85}rem` }}
          />
        }
      >
        {row.kind === 'group' ? (
          <button
            type="button"
            aria-label={expanded ? 'Collapse group' : 'Expand group'}
            className="flex size-4 shrink-0 items-center justify-center rounded hover:bg-secondary"
            onClick={(event) => {
              event.stopPropagation()
              onToggleExpand?.()
            }}
          >
            <ChevronRightIcon
              className={cn('size-3 transition-transform duration-150', expanded && 'rotate-90')}
            />
          </button>
        ) : (
          <span className="size-4 shrink-0" aria-hidden />
        )}

        <span
          title={row.kind === 'group' ? 'Group' : layerKindLabel(layerKind(row.element))}
          className="flex shrink-0 items-center"
        >
          {row.kind === 'group' ? (
            <FolderIcon aria-hidden className="size-3.5 shrink-0 opacity-70" />
          ) : (
            <LayerKindIcon kind={layerKind(row.element)} />
          )}
        </span>

        {renaming && row.kind === 'element' ? (
          <input
            autoFocus
            aria-label={`Rename ${label}`}
            defaultValue={row.element.name}
            className="w-full bg-transparent text-xs outline-none"
            onBlur={(event) => onCommitRename(event.target.value.trim() || 'Element')}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur()
            }}
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{label}</span>
        )}

        {/* Toggles stay mounted once active so an off state is never a surprise. */}
        <RowToggle
          active={locked}
          label={locked ? `Unlock ${label}` : `Lock ${label}`}
          onClick={onToggleLocked}
        >
          {locked ? <LockIcon className="size-3.5" /> : <UnlockIcon className="size-3.5" />}
        </RowToggle>
        <RowToggle
          active={hidden}
          label={hidden ? `Show ${label}` : `Hide ${label}`}
          onClick={onToggleHidden}
        >
          {hidden ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
        </RowToggle>
      </ContextMenuTrigger>
      {menu}
    </ContextMenu>
  )
}

function RowToggle({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        !active && 'opacity-0 group-hover/layer:opacity-100 focus-visible:opacity-100',
      )}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      {children}
    </button>
  )
}

function RowMenu({
  ids,
  elements,
  onSetFlags,
  onDuplicate,
  onDelete,
  onGroup,
  onUngroup,
  onRaise,
  onLower,
  onRename,
}: {
  ids: string[]
  elements: CanvasElement[]
  onSetFlags: (ids: string[], patch: { hidden?: boolean; locked?: boolean }) => void
  onDuplicate: (ids: string[]) => void
  onDelete: (ids: string[]) => void
  onGroup: (ids: string[]) => void
  onUngroup: (ids: string[]) => void
  onRaise: (ids: string[]) => void
  onLower: (ids: string[]) => void
  onRename?: () => void
}) {
  const targets = elements.filter((element) => ids.includes(element.id))
  const hidden = targets.length > 0 && targets.every((element) => element.hidden === true)
  const locked = targets.length > 0 && targets.every((element) => element.locked === true)
  const grouped = targets.some((element) => element.groupId)

  return (
    <ContextMenuPopup align="start" className="w-52">
      {onRename ? <ContextMenuItem onClick={onRename}>Rename</ContextMenuItem> : null}
      <ContextMenuItem onClick={() => onDuplicate(ids)}>Duplicate</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => onSetFlags(ids, { hidden: !hidden })}>
        {hidden ? 'Show' : 'Hide'}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onSetFlags(ids, { locked: !locked })}>
        {locked ? 'Unlock' : 'Lock'}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => onRaise(ids)}>Bring forward</ContextMenuItem>
      <ContextMenuItem onClick={() => onLower(ids)}>Send backward</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={ids.length < 2} onClick={() => onGroup(ids)}>
        Group
      </ContextMenuItem>
      <ContextMenuItem disabled={!grouped} onClick={() => onUngroup(ids)}>
        Ungroup
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onClick={() => onDelete(ids)}>
        Delete
      </ContextMenuItem>
    </ContextMenuPopup>
  )
}
