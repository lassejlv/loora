import { memo, useEffect, useRef, useState } from 'react'
import type { Shape, ShapeType } from '#/lib/canvas'
import { LINE_HEIGHT, renderOrder, shapeId } from '#/lib/canvas'
import { ComponentFrame } from '#/components/component-frame'
import { FrameBody } from '#/components/frame-body'

export type Tool = 'select' | 'hand' | ShapeType

interface View {
  x: number
  y: number
  scale: number
}

export interface CanvasControls {
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
  zoomToFit: () => void
  zoomToSelection: () => void
}

interface CanvasProps {
  shapes: Shape[]
  selectedIds: string[]
  tool: Tool
  docId?: string
  controlsRef?: React.RefObject<CanvasControls | null>
  onScaleChange?: (pct: number) => void
  onSelect: (ids: string[]) => void
  onToolChange: (tool: Tool) => void
  onCreate: (shape: Shape) => void
  onUpdate: (id: string, patch: Partial<Shape>) => void
}

type Drag =
  | { mode: 'pan'; startX: number; startY: number; view: View }
  | {
      mode: 'move'
      startX: number
      startY: number
      origins: { id: string; ox: number; oy: number; w: number; h: number }[]
    }
  | { mode: 'draw'; type: ShapeType; startX: number; startY: number; x: number; y: number; w: number; h: number }
  | { mode: 'marquee'; additive: boolean; startX: number; startY: number; x: number; y: number; w: number; h: number }
  | { mode: 'resize'; id: string; corner: number; start: Shape }

const HANDLE_CORNERS = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
] as const

const MIN_SCALE = 0.1
const MAX_SCALE = 16

function loadView(docId?: string): View {
  if (!docId || typeof localStorage === 'undefined') return { x: 0, y: 0, scale: 1 }
  try {
    const raw = localStorage.getItem(`loora:view:${docId}`)
    if (raw) {
      const v = JSON.parse(raw) as View
      if (Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.scale)) return v
    }
  } catch {
    // corrupt entry: fall through to default
  }
  return { x: 0, y: 0, scale: 1 }
}

export function Canvas({
  shapes,
  selectedIds,
  tool,
  docId,
  controlsRef,
  onScaleChange,
  onSelect,
  onToolChange,
  onCreate,
  onUpdate,
}: CanvasProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>(() => loadView(docId))
  const [drag, setDrag] = useState<Drag | null>(null)
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] })
  const [editingId, setEditingId] = useState<string | null>(null)
  // Component shape currently in "interact" mode: its iframe receives pointer
  // events instead of the canvas. Entered by double-click, left by clicking out.
  const [interactiveId, setInteractiveId] = useState<string | null>(null)
  const dragRef = useRef<Drag | null>(null)
  dragRef.current = drag

  const toScene = (clientX: number, clientY: number) => {
    const rect = rootRef.current!.getBoundingClientRect()
    return {
      x: (clientX - rect.left - view.x) / view.scale,
      y: (clientY - rect.top - view.y) / view.scale,
    }
  }

  const setDragBoth = (d: Drag | null) => {
    dragRef.current = d
    setDrag(d)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return
    // Clicks inside an interactive iframe never reach the canvas, so any
    // pointer down that lands here means the user clicked outside it.
    if (interactiveId) setInteractiveId(null)
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const pt = toScene(e.clientX, e.clientY)

    if (tool === 'hand' || e.button === 1) {
      setDragBoth({ mode: 'pan', startX: e.clientX, startY: e.clientY, view })
      return
    }

    if (tool === 'select') {
      const target = (e.target as Element).closest('[data-shape-id]')
      const id = target?.getAttribute('data-shape-id') ?? null
      if (id) {
        // Clicking a grouped shape acts on the whole group.
        const gid = shapes.find((s) => s.id === id)?.groupId
        const member = gid ? shapes.filter((s) => s.groupId === gid).map((s) => s.id) : [id]
        if (e.shiftKey) {
          onSelect(
            selectedIds.includes(id)
              ? selectedIds.filter((i) => !member.includes(i))
              : [...new Set([...selectedIds, ...member])],
          )
          return
        }
        const ids = selectedIds.includes(id) ? selectedIds : member
        if (ids !== selectedIds) onSelect(ids)
        const origins = shapes
          .filter((s) => ids.includes(s.id))
          .map((s) => ({ id: s.id, ox: s.x, oy: s.y, w: s.w, h: s.h }))
        setDragBoth({ mode: 'move', startX: pt.x, startY: pt.y, origins })
      } else {
        setDragBoth({
          mode: 'marquee',
          additive: e.shiftKey,
          startX: pt.x,
          startY: pt.y,
          x: pt.x,
          y: pt.y,
          w: 0,
          h: 0,
        })
      }
      return
    }

    // shape tools: drag out a new shape
    setDragBoth({ mode: 'draw', type: tool, startX: pt.x, startY: pt.y, x: pt.x, y: pt.y, w: 0, h: 0 })
  }

  const startResize = (e: React.PointerEvent, corner: number) => {
    e.stopPropagation()
    const s = selectedIds.length === 1 ? shapes.find((sh) => sh.id === selectedIds[0]) : undefined
    if (!s) return
    rootRef.current!.setPointerCapture(e.pointerId)
    setDragBoth({ mode: 'resize', id: s.id, corner, start: s })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    if (d.mode === 'pan') {
      setView({ ...d.view, x: d.view.x + e.clientX - d.startX, y: d.view.y + e.clientY - d.startY })
      return
    }
    const pt = toScene(e.clientX, e.clientY)
    if (d.mode === 'move') {
      let dx = pt.x - d.startX
      let dy = pt.y - d.startY

      // Snap the selection bounding box to edges/centers of other shapes.
      const movingIds = new Set(d.origins.map((o) => o.id))
      const left = Math.min(...d.origins.map((o) => o.ox)) + dx
      const top = Math.min(...d.origins.map((o) => o.oy)) + dy
      const right = Math.max(...d.origins.map((o) => o.ox + o.w)) + dx
      const bottom = Math.max(...d.origins.map((o) => o.oy + o.h)) + dy
      const threshold = 6 / view.scale
      const others = shapes.filter((s) => !movingIds.has(s.id))

      let bestX: { corr: number; line: number } | null = null
      let bestY: { corr: number; line: number } | null = null
      for (const s of others) {
        for (const c of [s.x, s.x + s.w / 2, s.x + s.w]) {
          for (const t of [left, (left + right) / 2, right]) {
            const corr = c - t
            if (Math.abs(corr) <= threshold && (!bestX || Math.abs(corr) < Math.abs(bestX.corr))) {
              bestX = { corr, line: c }
            }
          }
        }
        for (const c of [s.y, s.y + s.h / 2, s.y + s.h]) {
          for (const t of [top, (top + bottom) / 2, bottom]) {
            const corr = c - t
            if (Math.abs(corr) <= threshold && (!bestY || Math.abs(corr) < Math.abs(bestY.corr))) {
              bestY = { corr, line: c }
            }
          }
        }
      }
      if (bestX) dx += bestX.corr
      if (bestY) dy += bestY.corr
      setGuides({ v: bestX ? [bestX.line] : [], h: bestY ? [bestY.line] : [] })

      for (const o of d.origins) {
        onUpdate(o.id, { x: Math.round(o.ox + dx), y: Math.round(o.oy + dy) })
      }
    } else if (d.mode === 'draw' || d.mode === 'marquee') {
      const next = {
        ...d,
        x: Math.min(d.startX, pt.x),
        y: Math.min(d.startY, pt.y),
        w: Math.abs(pt.x - d.startX),
        h: Math.abs(pt.y - d.startY),
      }
      setDragBoth(next)
    } else if (d.mode === 'resize') {
      const [cx, cy] = HANDLE_CORNERS[d.corner]
      const { start } = d
      // Anchor: opposite corner, or the shape center when alt is held.
      const ax = e.altKey ? start.x + start.w / 2 : start.x + (1 - cx) * start.w
      const ay = e.altKey ? start.y + start.h / 2 : start.y + (1 - cy) * start.h
      const grow = e.altKey ? 2 : 1
      let w = Math.abs(pt.x - ax) * grow
      let h = Math.abs(pt.y - ay) * grow
      if (e.shiftKey && start.w > 0 && start.h > 0) {
        const ratio = start.w / start.h
        if (w / Math.max(h, 1e-6) > ratio) h = w / ratio
        else w = h * ratio
      }
      w = Math.max(1, Math.round(w))
      h = Math.max(1, Math.round(h))
      const x = e.altKey ? ax - w / 2 : pt.x < ax ? ax - w : ax
      const y = e.altKey ? ay - h / 2 : pt.y < ay ? ay - h : ay
      onUpdate(d.id, { x: Math.round(x), y: Math.round(y), w, h })
    }
  }

  const onPointerUp = () => {
    const d = dragRef.current
    if (d?.mode === 'draw') {
      const dragged = d.w > 4 || d.h > 4
      const defaults: Record<ShapeType, { w: number; h: number }> = {
        rect: { w: 160, h: 100 },
        ellipse: { w: 160, h: 100 },
        text: { w: 120, h: 28 },
        frame: { w: 375, h: 812 },
        image: { w: 320, h: 240 },
        component: { w: 360, h: 280 },
      }
      const def = defaults[d.type]
      const shape: Shape = {
        id: shapeId(),
        type: d.type,
        x: Math.round(dragged ? d.x : d.startX - def.w / 2),
        y: Math.round(dragged ? d.y : d.startY - def.h / 2),
        w: Math.round(dragged ? d.w : def.w),
        h: Math.round(dragged ? d.h : def.h),
        fill: d.type === 'text' ? '#1a1917' : '#ffffff',
        ...(d.type === 'text' ? { text: 'Text', fontSize: 20 } : {}),
        ...(d.type === 'frame' ? { text: 'Frame' } : {}),
      }
      onCreate(shape)
      onSelect([shape.id])
      onToolChange('select')
      if (d.type === 'text') setEditingId(shape.id)
    }
    if (d?.mode === 'marquee') {
      // Frames must be fully enclosed to be caught; other shapes just intersect.
      const hits = shapes
        .filter((s) =>
          s.type === 'frame'
            ? s.x >= d.x && s.y >= d.y && s.x + s.w <= d.x + d.w && s.y + s.h <= d.y + d.h
            : s.x < d.x + d.w && s.x + s.w > d.x && s.y < d.y + d.h && s.y + s.h > d.y,
        )
        .map((s) => s.id)
      // A marquee touching any group member catches the whole group.
      const groups = new Set(
        shapes.filter((s) => hits.includes(s.id) && s.groupId).map((s) => s.groupId),
      )
      const expanded = [
        ...new Set([...hits, ...shapes.filter((s) => s.groupId && groups.has(s.groupId)).map((s) => s.id)]),
      ]
      onSelect(d.additive ? [...new Set([...selectedIds, ...expanded])] : expanded)
    }
    setDragBoth(null)
    setGuides({ v: [], h: [] })
  }

  // React attaches wheel listeners passively, so preventDefault there is a
  // no-op — the browser still page-zooms on trackpad pinch (ctrl+wheel).
  // Block it (and Safari's gesture events) with native non-passive listeners.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const blockWheel = (e: WheelEvent) => e.preventDefault()
    const blockGesture = (e: Event) => e.preventDefault()
    el.addEventListener('wheel', blockWheel, { passive: false })
    el.addEventListener('gesturestart', blockGesture)
    el.addEventListener('gesturechange', blockGesture)
    return () => {
      el.removeEventListener('wheel', blockWheel)
      el.removeEventListener('gesturestart', blockGesture)
      el.removeEventListener('gesturechange', blockGesture)
    }
  }, [])

  // Per-doc pan/zoom: reload on doc switch, persist (debounced) on change.
  useEffect(() => {
    setView(loadView(docId))
  }, [docId])
  useEffect(() => {
    if (!docId) return
    const t = window.setTimeout(
      () => localStorage.setItem(`loora:view:${docId}`, JSON.stringify(view)),
      300,
    )
    return () => window.clearTimeout(t)
  }, [view, docId])

  useEffect(() => {
    onScaleChange?.(Math.round(view.scale * 100))
  }, [view.scale, onScaleChange])

  // Zoom keeping the given viewport point fixed.
  const zoomAt = (px: number, py: number, factor: number) => {
    setView((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor))
      const k = scale / v.scale
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k }
    })
  }

  const viewportSize = () => {
    const rect = rootRef.current?.getBoundingClientRect()
    return { w: rect?.width ?? 1200, h: rect?.height ?? 800 }
  }

  const zoomToBounds = (targets: Shape[]) => {
    if (targets.length === 0) return
    const left = Math.min(...targets.map((s) => s.x))
    const top = Math.min(...targets.map((s) => s.y))
    const right = Math.max(...targets.map((s) => s.x + s.w))
    const bottom = Math.max(...targets.map((s) => s.y + s.h))
    const { w, h } = viewportSize()
    const pad = 64
    const scale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, Math.min((w - pad * 2) / (right - left || 1), (h - pad * 2) / (bottom - top || 1))),
    )
    setView({
      scale,
      x: w / 2 - ((left + right) / 2) * scale,
      y: h / 2 - ((top + bottom) / 2) * scale,
    })
  }

  if (controlsRef) {
    controlsRef.current = {
      zoomIn: () => {
        const { w, h } = viewportSize()
        zoomAt(w / 2, h / 2, 1.25)
      },
      zoomOut: () => {
        const { w, h } = viewportSize()
        zoomAt(w / 2, h / 2, 1 / 1.25)
      },
      zoomReset: () => {
        const { w, h } = viewportSize()
        setView((v) => {
          const k = 1 / v.scale
          return { scale: 1, x: w / 2 - (w / 2 - v.x) * k, y: h / 2 - (h / 2 - v.y) * k }
        })
      },
      zoomToFit: () => zoomToBounds(shapes),
      zoomToSelection: () => zoomToBounds(shapes.filter((s) => selectedIds.includes(s.id))),
    }
  }

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const rect = rootRef.current!.getBoundingClientRect()
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.01))
    } else {
      setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
    }
  }

  const rootRect = rootRef.current?.getBoundingClientRect()
  const scene = {
    left: -view.x / view.scale,
    top: -view.y / view.scale,
    right: ((rootRect?.width ?? 2000) - view.x) / view.scale,
    bottom: ((rootRect?.height ?? 2000) - view.y) / view.scale,
  }
  const selectedShapes = shapes.filter((s) => selectedIds.includes(s.id))
  const single = selectedShapes.length === 1 ? selectedShapes[0] : undefined
  const editing = shapes.find((s) => s.id === editingId)
  const dot = 24 * view.scale
  const cursor =
    tool === 'hand'
      ? drag?.mode === 'pan'
        ? 'grabbing'
        : 'grab'
      : tool === 'select'
        ? 'default'
        : 'crosshair'

  return (
    <div
      ref={rootRef}
      className="relative h-full w-full touch-none select-none overflow-hidden bg-cx-canvas"
      style={{
        cursor,
        backgroundImage: 'radial-gradient(var(--cx-dot) 1px, transparent 1px)',
        backgroundSize: `${dot}px ${dot}px`,
        backgroundPosition: `${view.x % dot}px ${view.y % dot}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
      onDoubleClick={(e) => {
        const target = (e.target as Element).closest('[data-shape-id]')
        const id = target?.getAttribute('data-shape-id')
        const s = shapes.find((sh) => sh.id === id)
        if (s?.type === 'text') setEditingId(s.id)
        if (s?.type === 'component') {
          setInteractiveId(s.id)
          onSelect([])
        }
      }}
    >
      {/* Scene: real DOM, scaled with the view. */}
      <div
        className="absolute top-0 left-0"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          transformOrigin: '0 0',
        }}
      >
        {renderOrder(shapes).map((s) => (
          <ShapeView
            key={s.id}
            shape={s}
            hideText={s.id === editingId}
            interactive={s.id === interactiveId}
          />
        ))}

        {editing && (
          <textarea
            autoFocus
            defaultValue={editing.text}
            className="absolute resize-none bg-transparent outline-none"
            style={{
              left: editing.x,
              top: editing.y,
              width: Math.max(editing.w, 40),
              height: Math.max(editing.h, 32),
              font: `${editing.fontWeight ?? 400} ${editing.fontSize ?? 20}px var(--font-sans)`,
              lineHeight: LINE_HEIGHT,
              color: editing.fill,
              textAlign: editing.align ?? 'left',
            }}
            onBlur={(e) => {
              onUpdate(editing.id, { text: e.target.value })
              setEditingId(null)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') e.currentTarget.blur()
            }}
            onPointerDown={(e) => e.stopPropagation()}
          />
        )}
      </div>

      {/* Overlay chrome: selection, guides, marquee, handles. */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {(drag?.mode === 'draw' || drag?.mode === 'marquee') && (drag.w > 4 || drag.h > 4) && (
            <rect
              x={drag.x}
              y={drag.y}
              width={drag.w}
              height={drag.h}
              fill={drag.mode === 'marquee' ? 'rgba(36, 64, 230, 0.06)' : 'none'}
              stroke="var(--cx-accent)"
              strokeWidth={1 / view.scale}
              strokeDasharray={`${4 / view.scale} ${3 / view.scale}`}
            />
          )}

          {!editingId &&
            selectedShapes.map((s) => (
              <rect
                key={s.id}
                x={s.x}
                y={s.y}
                width={s.w}
                height={s.h}
                fill="none"
                stroke="var(--cx-accent)"
                strokeWidth={1.5 / view.scale}
              />
            ))}

          {guides.v.map((x) => (
            <line
              key={`v${x}`}
              x1={x}
              y1={scene.top}
              x2={x}
              y2={scene.bottom}
              stroke="#e8442e"
              strokeWidth={1 / view.scale}
            />
          ))}
          {guides.h.map((y) => (
            <line
              key={`h${y}`}
              x1={scene.left}
              y1={y}
              x2={scene.right}
              y2={y}
              stroke="#e8442e"
              strokeWidth={1 / view.scale}
            />
          ))}

          {single && !editingId && (
            <g>
              {HANDLE_CORNERS.map(([cx, cy], i) => (
                <rect
                  key={i}
                  x={single.x + cx * single.w - 4 / view.scale}
                  y={single.y + cy * single.h - 4 / view.scale}
                  width={8 / view.scale}
                  height={8 / view.scale}
                  fill="#ffffff"
                  stroke="var(--cx-accent)"
                  strokeWidth={1.5 / view.scale}
                  style={{
                    cursor: i % 2 === 0 ? 'nwse-resize' : 'nesw-resize',
                    pointerEvents: 'auto',
                  }}
                  onPointerDown={(e) => startResize(e, i)}
                />
              ))}
              <text
                x={single.x}
                y={single.y + single.h + 16 / view.scale}
                fontSize={11 / view.scale}
                fontFamily="var(--font-mono)"
                fill="var(--cx-accent)"
              >
                {`${single.x}, ${single.y} · ${single.w} × ${single.h}`}
              </text>
            </g>
          )}
        </g>
      </svg>
    </div>
  )
}

const ShapeView = memo(function ShapeView({
  shape: s,
  hideText,
  interactive,
}: {
  shape: Shape
  hideText?: boolean
  interactive?: boolean
}) {
  const box: React.CSSProperties = {
    position: 'absolute',
    left: s.x,
    top: s.y,
    width: s.w,
    height: s.h,
    opacity: s.opacity,
  }

  if (s.type === 'image') {
    return (
      <img
        data-shape-id={s.id}
        src={s.src}
        alt={s.text ?? ''}
        draggable={false}
        // maxWidth: Tailwind preflight sets img{max-width:100%}, and the scene
        // container has zero intrinsic width — without this the image collapses to 0.
        style={{ ...box, objectFit: 'fill', maxWidth: 'none' }}
      />
    )
  }

  if (s.type === 'component') {
    return (
      <div style={box}>
        <div
          className="pointer-events-none absolute font-mono"
          style={{
            top: -20,
            left: 0,
            fontSize: 12,
            whiteSpace: 'nowrap',
            color: interactive ? 'var(--cx-accent)' : 'var(--color-muted-foreground)',
          }}
        >
          {`⚛ ${s.text ?? 'Component'}${interactive ? ' · interacting (click outside to exit)' : ' · double-click to interact'}`}
        </div>
        <div className="h-full w-full overflow-hidden rounded-md shadow-sm ring-1 ring-black/10">
          <ComponentFrame shapeId={s.id} code={s.code ?? ''} interactive={!!interactive} />
        </div>
        {/* transparent hit layer so select/move/resize work; removed in interact mode */}
        {!interactive && <div data-shape-id={s.id} className="absolute inset-0" />}
      </div>
    )
  }

  if (s.type === 'text') {
    return (
      <div
        data-shape-id={s.id}
        style={{
          ...box,
          font: `${s.fontWeight ?? 400} ${s.fontSize ?? 20}px var(--font-sans)`,
          lineHeight: LINE_HEIGHT,
          color: hideText ? 'transparent' : s.fill,
          textAlign: s.align ?? 'left',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
        }}
      >
        {s.text}
      </div>
    )
  }

  if (s.type === 'frame') {
    return (
      <div data-shape-id={s.id} style={box}>
        <div
          className="pointer-events-none absolute font-mono"
          style={{
            top: -20,
            left: 0,
            fontSize: 12,
            whiteSpace: 'nowrap',
            color: 'var(--color-muted-foreground)',
          }}
        >
          {s.text ?? 'Frame'}
        </div>
        <div
          className="h-full w-full"
          style={{
            backgroundColor: s.fill,
            border: `${s.strokeWidth ?? 1}px solid ${s.stroke ?? 'var(--cx-dot)'}`,
            borderRadius: s.radius ?? 0,
            overflow: s.html ? 'hidden' : undefined,
          }}
        >
          {s.html && <FrameBody html={s.html} />}
        </div>
      </div>
    )
  }

  // rect / ellipse
  return (
    <div
      data-shape-id={s.id}
      style={{
        ...box,
        backgroundColor: s.fill,
        border: s.stroke
          ? `${s.strokeWidth ?? 1}px solid ${s.stroke}`
          : '1px solid rgba(0,0,0,0.12)',
        borderRadius: s.type === 'ellipse' ? '50%' : (s.radius ?? 0),
      }}
    />
  )
})
