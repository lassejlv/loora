import { useCallback, useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  CircleIcon,
  FrameIcon,
  HandIcon,
  MousePointer2Icon,
  Redo2Icon,
  SquareIcon,
  Undo2Icon,
  Trash2Icon,
  TypeIcon,
} from 'lucide-react'
import { Canvas, type Tool } from '#/components/canvas'
import { AgentPanel } from '#/components/agent-panel'
import { PALETTE, shapeId, type CanvasActions, type Shape } from '#/lib/canvas'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'

export const Route = createFileRoute('/')({ component: App, ssr: false })

const SHAPES_STORAGE = 'loora:shapes'
const LEGACY_SHAPES_STORAGE = 'canvasx:shapes'

const TOOLS: { tool: Tool; icon: typeof SquareIcon; key: string; label: string }[] = [
  { tool: 'select', icon: MousePointer2Icon, key: 'v', label: 'Select' },
  { tool: 'frame', icon: FrameIcon, key: 'f', label: 'Frame' },
  { tool: 'rect', icon: SquareIcon, key: 'r', label: 'Rectangle' },
  { tool: 'ellipse', icon: CircleIcon, key: 'o', label: 'Ellipse' },
  { tool: 'text', icon: TypeIcon, key: 't', label: 'Text' },
  { tool: 'hand', icon: HandIcon, key: 'h', label: 'Hand' },
]

function App() {
  const [shapes, setShapes] = useState<Shape[]>(() => {
    try {
      return JSON.parse(
        localStorage.getItem(SHAPES_STORAGE) ?? localStorage.getItem(LEGACY_SHAPES_STORAGE) ?? '[]',
      )
    } catch {
      return []
    }
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>('select')

  const shapesRef = useRef(shapes)
  shapesRef.current = shapes

  // Undo history: mutations within 800ms coalesce into one step
  // (a drag, a typed number, an agent burst each become a single undo).
  const past = useRef<Shape[][]>([])
  const future = useRef<Shape[][]>([])
  const lastMutation = useRef(0)
  const [, bumpHistory] = useState(0)

  useEffect(() => {
    localStorage.setItem(SHAPES_STORAGE, JSON.stringify(shapes))
  }, [shapes])

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
      setSelectedId((sel) => (sel === id ? null : sel))
      return exists
    },
    [mutate],
  )

  const actions: CanvasActions = { createShape, updateShape, deleteShape }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, [contenteditable]')) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      const t = TOOLS.find((x) => x.key === e.key.toLowerCase())
      if (t && !e.metaKey && !e.ctrlKey) setTool(t.tool)
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) deleteShape(selectedId)
      if (e.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId, deleteShape, undo, redo])

  const selected = shapes.find((s) => s.id === selectedId)

  return (
    <div className="flex h-full">
      <main className="relative min-w-0 flex-1">
        <Canvas
          shapes={shapes}
          selectedId={selectedId}
          tool={tool}
          onSelect={setSelectedId}
          onToolChange={setTool}
          onCreate={(s) => mutate((prev) => [...prev, s])}
          onUpdate={updateShape}
        />

        <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
          <span className="text-sm font-semibold tracking-tight">
            loora<span className="text-cx-accent">.</span>
          </span>
        </div>

        <div className="absolute top-1/2 left-4 flex -translate-y-1/2 flex-col gap-1 rounded-xl border bg-card p-1 shadow-sm">
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
                onClick={() => updateShape(selected.id, { fill: color })}
              />
            ))}
            {selected.type !== 'text' && (
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
                  onClick={() => updateShape(selected.id, { stroke: undefined, strokeWidth: undefined })}
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
                    onClick={() => updateShape(selected.id, { stroke: color, strokeWidth: selected.strokeWidth ?? 2 })}
                  />
                ))}
              </>
            )}
            {(selected.type === 'rect' || selected.type === 'frame') && (
              <>
                <div className="mx-1 h-4 w-px bg-border" />
                <label className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                  R
                  <input
                    type="number"
                    min={0}
                    value={selected.radius ?? 0}
                    onChange={(e) => updateShape(selected.id, { radius: Math.max(0, Number(e.target.value)) })}
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
                  updateShape(selected.id, {
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
              aria-label="Delete shape"
              onClick={() => deleteShape(selected.id)}
            >
              <Trash2Icon data-slot="icon" />
            </Button>
          </div>
        )}
      </main>

      <AgentPanel actions={actions} shapesRef={shapesRef} />
    </div>
  )
}
