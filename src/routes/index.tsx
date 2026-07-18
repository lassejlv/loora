import { useCallback, useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BringToFrontIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleIcon,
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  FrameIcon,
  HandIcon,
  LogOutIcon,
  MousePointer2Icon,
  PanelRightIcon,
  Redo2Icon,
  SendToBackIcon,
  SquareIcon,
  Undo2Icon,
  Trash2Icon,
  TypeIcon,
} from 'lucide-react'
import { Canvas, type Tool } from '#/components/canvas'
import {
  deleteDocStorage,
  docId,
  loadDocs,
  loadShapes,
  saveDocs,
  saveShapes,
  type DocMeta,
} from '#/lib/docs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { LayersPanel } from '#/components/layers-panel'
import { HistoryPopover } from '#/components/history-panel'
import { deleteHistory } from '#/lib/history'
import { snapshotCanvas } from '#/lib/snapshot'
import { AgentPanel } from '#/components/agent-panel'
import { PALETTE, shapeId, type CanvasActions, type Shape } from '#/lib/canvas'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import { AuthScreen } from '#/components/auth-screen'
import { authClient } from '#/lib/auth-client'
import { SidebarProvider, SidebarTrigger } from '#/components/ui/sidebar'
import { orpc } from '#/lib/orpc-client'
import { Drawer, DrawerPopup, DrawerTrigger } from '#/components/ui/drawer'

export const Route = createFileRoute('/')({ component: App, ssr: false })

function App() {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) {
    return (
      <main className="grid min-h-screen place-items-center bg-cx-canvas">
        <p className="cx-shimmer text-sm">Opening your canvas…</p>
      </main>
    )
  }

  if (!session) {
    return (
      <>
        <div aria-hidden="true" className="pointer-events-none select-none" inert>
          <Editor preview />
        </div>
        <AuthScreen />
      </>
    )
  }

  return <Editor userId={session.user.id} />
}

function DocSwitcher({
  docs,
  activeId,
  onSwitch,
  onNew,
  onRename,
  onDelete,
}: {
  docs: DocMeta[]
  activeId: string
  onSwitch: (id: string) => void
  onNew: () => void
  onRename: (name: string) => void
  onDelete: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const active = docs.find((d) => d.id === activeId)

  if (renaming) {
    return (
      <input
        autoFocus
        defaultValue={active?.name}
        className="pointer-events-auto w-40 rounded border bg-card px-1.5 py-0.5 text-sm outline-none"
        onBlur={(e) => {
          const name = e.target.value.trim()
          if (name) onRename(name)
          setRenaming(false)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
        }}
      />
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="pointer-events-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          {active?.name ?? 'Untitled'}
          <ChevronDownIcon className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="pointer-events-auto w-52">
        {docs.map((d) => (
          <DropdownMenuItem key={d.id} onClick={() => onSwitch(d.id)}>
            <span className="min-w-0 flex-1 truncate">{d.name}</span>
            {d.id === activeId && <CheckIcon className="size-3.5" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onNew}>New document</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setRenaming(true)}>Rename</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          Delete document
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const TOOLS: { tool: Tool; icon: typeof SquareIcon; key: string; label: string }[] = [
  { tool: 'select', icon: MousePointer2Icon, key: 'v', label: 'Select' },
  { tool: 'frame', icon: FrameIcon, key: 'f', label: 'Frame' },
  { tool: 'rect', icon: SquareIcon, key: 'r', label: 'Rectangle' },
  { tool: 'ellipse', icon: CircleIcon, key: 'o', label: 'Ellipse' },
  { tool: 'text', icon: TypeIcon, key: 't', label: 'Text' },
  { tool: 'hand', icon: HandIcon, key: 'h', label: 'Hand' },
]

function Editor({ preview = false, userId }: { preview?: boolean; userId?: string }) {
  const cacheOwner = preview ? null : localStorage.getItem('loora:cache-user')
  const cacheOwnedByAnotherUser = Boolean(userId && cacheOwner && cacheOwner !== userId)
  const [{ docs, activeId }, setDocState] = useState(() => {
    if (preview) return { docs: [{ id: 'preview', name: 'Untitled' }], activeId: 'preview' }
    if (cacheOwnedByAnotherUser) {
      const id = docId()
      return { docs: [{ id, name: 'Untitled' }], activeId: id }
    }
    return loadDocs()
  })
  const [shapes, setShapes] = useState<Shape[]>(() =>
    preview || cacheOwnedByAnotherUser ? [] : loadShapes(activeId),
  )
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [tool, setTool] = useState<Tool>('select')
  const [databaseReady, setDatabaseReady] = useState(false)
  const [layersOpen, setLayersOpen] = useState(() =>
    preview ? false : localStorage.getItem('loora:layers') === '1',
  )
  const toggleLayers = (open: boolean) => {
    setLayersOpen(open)
    localStorage.setItem('loora:layers', open ? '1' : '0')
  }

  const shapesRef = useRef(shapes)
  shapesRef.current = shapes

  useEffect(() => {
    if (preview) return
    let cancelled = false

    const hydrateFromDatabase = async () => {
      try {
        const remote = await orpc.design.list()
        if (cancelled) return

        if (remote.length === 0) {
          await Promise.all(
            docs.map((doc) =>
              orpc.design.save({ id: doc.id, name: doc.name, shapes: loadShapes(doc.id) }),
            ),
          )
          saveDocs(docs, activeId)
        } else {
          const remoteDocs = remote.map(({ id, name }) => ({ id, name }))
          const nextActive = remote.some((doc) => doc.id === activeId) ? activeId : remote[0].id
          for (const doc of remote) saveShapes(doc.id, doc.shapes)
          saveDocs(remoteDocs, nextActive)
          setDocState({ docs: remoteDocs, activeId: nextActive })
          setShapes(remote.find((doc) => doc.id === nextActive)?.shapes ?? [])
          setSelectedIds([])
        }

        if (!cancelled) {
          if (userId) localStorage.setItem('loora:cache-user', userId)
          setDatabaseReady(true)
        }
      } catch (error) {
        console.error('[designs] Failed to load designs:', error)
      }
    }

    void hydrateFromDatabase()
    return () => {
      cancelled = true
    }
  }, [preview, userId])

  // Undo history: mutations within 800ms coalesce into one step
  // (a drag, a typed number, an agent burst each become a single undo).
  const past = useRef<Shape[][]>([])
  const future = useRef<Shape[][]>([])
  const lastMutation = useRef(0)
  const [, bumpHistory] = useState(0)

  useEffect(() => {
    if (preview) return
    saveShapes(activeId, shapes)
  }, [shapes, activeId, preview])

  useEffect(() => {
    if (preview || !databaseReady) return
    const active = docs.find((doc) => doc.id === activeId)
    if (!active) return

    const timeout = window.setTimeout(() => {
      void orpc.design
        .save({ id: active.id, name: active.name, shapes })
        .catch((error) => console.error('[designs] Failed to save design:', error))
    }, 500)

    return () => window.clearTimeout(timeout)
  }, [activeId, databaseReady, docs, preview, shapes])

  const resetHistory = () => {
    past.current = []
    future.current = []
    lastMutation.current = 0
  }

  const switchDoc = (id: string) => {
    if (id === activeId) return
    const active = docs.find((doc) => doc.id === activeId)
    if (databaseReady && active) {
      void orpc.design
        .save({ id: active.id, name: active.name, shapes: shapesRef.current })
        .catch((error) => console.error('[designs] Failed to save design:', error))
    }
    setDocState((s) => {
      saveDocs(s.docs, id)
      return { ...s, activeId: id }
    })
    setShapes(loadShapes(id))
    setSelectedIds([])
    resetHistory()
  }

  const newDoc = () => {
    const active = docs.find((doc) => doc.id === activeId)
    if (databaseReady && active) {
      void orpc.design
        .save({ id: active.id, name: active.name, shapes: shapesRef.current })
        .catch((error) => console.error('[designs] Failed to save design:', error))
    }
    const doc = { id: docId(), name: `Untitled ${docs.length + 1}` }
    const next = [...docs, doc]
    saveShapes(doc.id, [])
    saveDocs(next, doc.id)
    setDocState({ docs: next, activeId: doc.id })
    setShapes([])
    setSelectedIds([])
    resetHistory()
  }

  const renameDoc = (name: string) => {
    const next = docs.map((d) => (d.id === activeId ? { ...d, name } : d))
    saveDocs(next, activeId)
    setDocState({ docs: next, activeId })
  }

  const deleteDoc = () => {
    if (databaseReady) {
      void orpc.design
        .delete({ id: activeId })
        .catch((error) => console.error('[designs] Failed to delete design:', error))
    }
    deleteDocStorage(activeId)
    deleteHistory(activeId)
    let next = docs.filter((d) => d.id !== activeId)
    if (next.length === 0) {
      next = [{ id: docId(), name: 'Untitled' }]
      saveShapes(next[0].id, [])
    }
    saveDocs(next, next[0].id)
    setDocState({ docs: next, activeId: next[0].id })
    setShapes(loadShapes(next[0].id))
    setSelectedIds([])
    resetHistory()
  }

  const mutate = useCallback((fn: (prev: Shape[]) => Shape[]) => {
    setShapes((prev) => {
      const now = Date.now()
      if (now - lastMutation.current > 800) {
        past.current.push(prev)
        if (past.current.length > 100) past.current.shift()
        future.current = []
      }
      lastMutation.current = now
      return fn(prev)
    })
  }, [])

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(shapesRef.current)
    lastMutation.current = 0
    setShapes(prev)
    bumpHistory((n) => n + 1)
  }, [])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(shapesRef.current)
    lastMutation.current = 0
    setShapes(next)
    bumpHistory((n) => n + 1)
  }, [])

  const createShape = useCallback(
    (shape: Omit<Shape, 'id'> & { id?: string }) => {
      const full: Shape = { fontSize: shape.type === 'text' ? 20 : undefined, ...shape, id: shape.id ?? shapeId() }
      mutate((prev) => [...prev, full])
      return full
    },
    [mutate],
  )

  const createShapes = useCallback(
    (batch: Omit<Shape, 'id'>[]) => {
      const full = batch.map((shape) => ({
        fontSize: shape.type === 'text' ? 20 : undefined,
        ...shape,
        id: shapeId(),
      }))
      mutate((prev) => [...prev, ...full])
      return full
    },
    [mutate],
  )

  const updateShape = useCallback(
    (id: string, patch: Partial<Omit<Shape, 'id'>>) => {
      let updated: Shape | null = null
      mutate((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s
          updated = { ...s, ...patch }
          return updated
        }),
      )
      return updated ?? shapesRef.current.find((s) => s.id === id) ?? null
    },
    [mutate],
  )

  const deleteShape = useCallback(
    (id: string) => {
      const exists = shapesRef.current.some((s) => s.id === id)
      mutate((prev) => prev.filter((s) => s.id !== id))
      setSelectedIds((sel) => sel.filter((i) => i !== id))
      return exists
    },
    [mutate],
  )

  const deleteSelected = useCallback(() => {
    setSelectedIds((sel) => {
      if (sel.length > 0) mutate((prev) => prev.filter((s) => !sel.includes(s.id)))
      return []
    })
  }, [mutate])

  const updateSelected = useCallback(
    (ids: string[], patch: Partial<Omit<Shape, 'id'>>) => {
      mutate((prev) => prev.map((s) => (ids.includes(s.id) ? { ...s, ...patch } : s)))
    },
    [mutate],
  )

  const duplicateSelected = useCallback(() => {
    const targets = shapesRef.current.filter((s) => selectedIds.includes(s.id))
    if (targets.length === 0) return
    const copies = targets.map((s) => ({ ...s, id: shapeId(), x: s.x + 16, y: s.y + 16 }))
    mutate((prev) => [...prev, ...copies])
    setSelectedIds(copies.map((c) => c.id))
  }, [mutate, selectedIds])

  // In-memory clipboard; repeated pastes cascade by +16 each.
  const clipboard = useRef<{ shapes: Shape[]; pastes: number }>({ shapes: [], pastes: 0 })

  const copySelected = useCallback(() => {
    const targets = shapesRef.current.filter((s) => selectedIds.includes(s.id))
    if (targets.length > 0) clipboard.current = { shapes: targets, pastes: 0 }
  }, [selectedIds])

  const paste = useCallback(() => {
    const { shapes: clip } = clipboard.current
    if (clip.length === 0) return
    clipboard.current.pastes += 1
    const offset = 16 * clipboard.current.pastes
    const copies = clip.map((s) => ({ ...s, id: shapeId(), x: s.x + offset, y: s.y + offset }))
    mutate((prev) => [...prev, ...copies])
    setSelectedIds(copies.map((c) => c.id))
    setTool('select')
  }, [mutate])

  const actions: CanvasActions = { createShape, createShapes, updateShape, deleteShape }

  const reorder = useCallback(
    (dir: 'forward' | 'backward' | 'front' | 'back') => {
      const sel = new Set(selectedIds)
      if (sel.size === 0) return
      mutate((prev) => {
        const arr = [...prev]
        if (dir === 'front' || dir === 'back') {
          const chosen = arr.filter((s) => sel.has(s.id))
          const rest = arr.filter((s) => !sel.has(s.id))
          return dir === 'front' ? [...rest, ...chosen] : [...chosen, ...rest]
        }
        if (dir === 'forward') {
          for (let i = arr.length - 2; i >= 0; i--) {
            if (sel.has(arr[i].id) && !sel.has(arr[i + 1].id)) {
              ;[arr[i], arr[i + 1]] = [arr[i + 1], arr[i]]
            }
          }
        } else {
          for (let i = 1; i < arr.length; i++) {
            if (sel.has(arr[i].id) && !sel.has(arr[i - 1].id)) {
              ;[arr[i], arr[i - 1]] = [arr[i - 1], arr[i]]
            }
          }
        }
        return arr
      })
    },
    [mutate, selectedIds],
  )

  const exportPng = useCallback(async () => {
    const all = shapesRef.current
    const targets = selectedIds.length > 0 ? all.filter((s) => selectedIds.includes(s.id)) : all
    const url = await snapshotCanvas(targets, { pixelRatio: 2 })
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = 'loora.png'
    a.click()
  }, [selectedIds])

  useEffect(() => {
    if (preview) return
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, [contenteditable]')) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        duplicateSelected()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        copySelected()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        paste()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'x') {
        copySelected()
        deleteSelected()
        return
      }
      if (e.key === ']' || e.key === '}') {
        e.preventDefault()
        reorder(e.shiftKey ? 'front' : 'forward')
        return
      }
      if (e.key === '[' || e.key === '{') {
        e.preventDefault()
        reorder(e.shiftKey ? 'back' : 'backward')
        return
      }
      const t = TOOLS.find((x) => x.key === e.key.toLowerCase())
      if (t && !e.metaKey && !e.ctrlKey) setTool(t.tool)
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected()
      if (e.key === 'Escape') setSelectedIds([])
      if (e.key.startsWith('Arrow') && selectedIds.length > 0) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        mutate((prev) =>
          prev.map((s) => (selectedIds.includes(s.id) ? { ...s, x: s.x + dx, y: s.y + dy } : s)),
        )
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [deleteSelected, duplicateSelected, undo, redo, reorder, copySelected, paste, selectedIds, mutate, preview])

  const selectedShapes = shapes.filter((s) => selectedIds.includes(s.id))
  const selected = selectedShapes[0]

  return (
    <SidebarProvider
      className="h-full min-h-0 bg-cx-canvas"
      style={{ '--sidebar-width': '21.25rem' } as React.CSSProperties}
    >
      <AgentPanel
        key={activeId}
        actions={actions}
        shapesRef={shapesRef}
        docId={activeId}
        ready={databaseReady}
      />

      <main className="relative min-w-0 flex-1">
        <Canvas
          shapes={shapes}
          selectedIds={selectedIds}
          tool={tool}
          onSelect={setSelectedIds}
          onToolChange={setTool}
          onCreate={(s) => mutate((prev) => [...prev, s])}
          onUpdate={updateShape}
        />

        <div className="absolute top-4 right-4 flex items-center gap-1">
          <SidebarTrigger aria-label="Toggle agent" title="Toggle agent" />
          <Drawer open={layersOpen} onOpenChange={toggleLayers} position="bottom">
            <DrawerTrigger
              render={
                <Button variant="ghost" size="icon" aria-label="Show layers" title="Layers" />
              }
            >
              <PanelRightIcon data-slot="icon" />
            </DrawerTrigger>
            <DrawerPopup
              position="bottom"
              variant="inset"
              className="h-[min(60svh,32rem)]"
            >
              <LayersPanel
                shapes={shapes}
                selectedIds={selectedIds}
                onSelect={setSelectedIds}
                onReorderList={(orderedIds) =>
                  mutate((prev) =>
                    [...prev].sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id)),
                  )
                }
                onRenameFrame={(id, name) => updateShape(id, { text: name })}
              />
            </DrawerPopup>
          </Drawer>
          <HistoryPopover
            docId={activeId}
            shapesRef={shapesRef}
            onRestore={(restored) => {
              mutate(() => restored)
              setSelectedIds([])
            }}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More actions" title="More actions">
                <EllipsisIcon data-slot="icon" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={exportPng} disabled={shapes.length === 0}>
                <DownloadIcon data-slot="icon" />
                {selectedIds.length > 0 ? 'Export selection' : 'Export canvas'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => authClient.signOut()}>
                <LogOutIcon data-slot="icon" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="pointer-events-none absolute inset-x-0 top-4 flex items-center justify-center gap-2">
          <span className="text-sm font-semibold tracking-tight">
            loora<span className="text-cx-accent">.</span>
          </span>
          <span className="text-muted-foreground/50">/</span>
          <DocSwitcher
            docs={docs}
            activeId={activeId}
            onSwitch={switchDoc}
            onNew={newDoc}
            onRename={renameDoc}
            onDelete={deleteDoc}
          />
        </div>

        <div className="absolute top-1/2 right-4 flex -translate-y-1/2 flex-col gap-1 rounded-xl border bg-card p-1 shadow-sm">
          {TOOLS.map(({ tool: t, icon: Icon, key, label }) => (
            <Button
              key={t}
              variant="ghost"
              size="icon"
              aria-label={`${label} (${key.toUpperCase()})`}
              title={`${label} (${key.toUpperCase()})`}
              className={cn(tool === t && 'bg-cx-accent/10 text-cx-accent hover:bg-cx-accent/10 hover:text-cx-accent')}
              onClick={() => setTool(t)}
            >
              <Icon data-slot="icon" />
            </Button>
          ))}
          <div className="mx-1 my-0.5 h-px bg-border" />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Undo (⌘Z)"
            title="Undo (⌘Z)"
            disabled={past.current.length === 0}
            onClick={undo}
          >
            <Undo2Icon data-slot="icon" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Redo (⇧⌘Z)"
            title="Redo (⇧⌘Z)"
            disabled={future.current.length === 0}
            onClick={redo}
          >
            <Redo2Icon data-slot="icon" />
          </Button>
        </div>

        {selected && (
          <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-card px-3 py-2 shadow-sm">
            {PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Fill ${color}`}
                className={cn(
                  'size-5 rounded-full border border-black/15 transition-transform hover:scale-110',
                  selected.fill === color && 'ring-2 ring-cx-accent ring-offset-1',
                )}
                style={{ backgroundColor: color }}
                onClick={() => updateSelected(selectedIds, { fill: color })}
              />
            ))}
            {selectedShapes.some((s) => s.type !== 'text') && (
              <>
                <div className="mx-1 h-4 w-px bg-border" />
                <button
                  type="button"
                  aria-label="No stroke"
                  title="No stroke"
                  className={cn(
                    'relative size-5 rounded-full border border-black/15 bg-white transition-transform hover:scale-110',
                    !selected.stroke && 'ring-2 ring-cx-accent ring-offset-1',
                  )}
                  onClick={() => updateSelected(selectedIds, { stroke: undefined, strokeWidth: undefined })}
                >
                  <span className="absolute inset-0.5 rotate-45 border-t border-red-400" />
                </button>
                {PALETTE.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Stroke ${color}`}
                    title="Stroke"
                    className={cn(
                      'size-5 rounded-full bg-transparent transition-transform hover:scale-110',
                      selected.stroke === color && 'ring-2 ring-cx-accent ring-offset-1',
                    )}
                    style={{ border: `2.5px solid ${color}` }}
                    onClick={() => updateSelected(selectedIds, { stroke: color, strokeWidth: selected.strokeWidth ?? 2 })}
                  />
                ))}
              </>
            )}
            {selected.type === 'text' && (
              <>
                <div className="mx-1 h-4 w-px bg-border" />
                <label className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                  S
                  <input
                    type="number"
                    min={6}
                    value={selected.fontSize ?? 20}
                    onChange={(e) =>
                      updateSelected(selectedIds, { fontSize: Math.max(6, Number(e.target.value)) })
                    }
                    className="w-11 rounded border bg-background px-1 py-0.5 text-foreground"
                  />
                </label>
                <select
                  aria-label="Font weight"
                  value={selected.fontWeight ?? 400}
                  onChange={(e) => updateSelected(selectedIds, { fontWeight: Number(e.target.value) })}
                  className="rounded border bg-background px-1 py-0.5 font-mono text-[11px] text-foreground"
                >
                  <option value={400}>Regular</option>
                  <option value={500}>Medium</option>
                  <option value={600}>Semibold</option>
                  <option value={700}>Bold</option>
                </select>
                {(
                  [
                    ['left', AlignLeftIcon],
                    ['center', AlignCenterIcon],
                    ['right', AlignRightIcon],
                  ] as const
                ).map(([align, Icon]) => (
                  <Button
                    key={align}
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Align ${align}`}
                    className={cn(
                      (selected.align ?? 'left') === align && 'bg-cx-accent/10 text-cx-accent',
                    )}
                    onClick={() => updateSelected(selectedIds, { align })}
                  >
                    <Icon data-slot="icon" />
                  </Button>
                ))}
              </>
            )}
            {selectedShapes.some((s) => s.type === 'rect' || s.type === 'frame') && (
              <>
                <div className="mx-1 h-4 w-px bg-border" />
                <label className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                  R
                  <input
                    type="number"
                    min={0}
                    value={selected.radius ?? 0}
                    onChange={(e) => updateSelected(selectedIds, { radius: Math.max(0, Number(e.target.value)) })}
                    className="w-11 rounded border bg-background px-1 py-0.5 text-foreground"
                  />
                </label>
              </>
            )}
            <div className="mx-1 h-4 w-px bg-border" />
            <label className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
              O
              <input
                type="number"
                min={0}
                max={100}
                value={Math.round((selected.opacity ?? 1) * 100)}
                onChange={(e) =>
                  updateSelected(selectedIds, {
                    opacity: Math.min(100, Math.max(0, Number(e.target.value))) / 100,
                  })
                }
                className="w-11 rounded border bg-background px-1 py-0.5 text-foreground"
              />
            </label>
            <div className="mx-1 h-4 w-px bg-border" />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Bring forward (], shift-click for front)"
              title="Bring forward (] · ⇧ front)"
              onClick={(e) => reorder(e.shiftKey ? 'front' : 'forward')}
            >
              <BringToFrontIcon data-slot="icon" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Send backward ([, shift-click for back)"
              title="Send backward ([ · ⇧ back)"
              onClick={(e) => reorder(e.shiftKey ? 'back' : 'backward')}
            >
              <SendToBackIcon data-slot="icon" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Duplicate selection (⌘D)"
              title="Duplicate (⌘D)"
              onClick={duplicateSelected}
            >
              <CopyIcon data-slot="icon" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete selection"
              title="Delete"
              onClick={deleteSelected}
            >
              <Trash2Icon data-slot="icon" />
            </Button>
          </div>
        )}
      </main>

    </SidebarProvider>
  )
}
