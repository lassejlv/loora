import { useRef, useState } from 'react'
import type { Shape, ShapeType } from '#/lib/canvas'
import { renderOrder, shapeId } from '#/lib/canvas'

export type Tool = 'select' | 'hand' | ShapeType

interface View {
  x: number
  y: number
  scale: number
}

interface CanvasProps {
  shapes: Shape[]
  selectedId: string | null
  tool: Tool
  onSelect: (id: string | null) => void
  onToolChange: (tool: Tool) => void
  onCreate: (shape: Shape) => void
  onUpdate: (id: string, patch: Partial<Shape>) => void
}

type Drag =
  | { mode: 'pan'; startX: number; startY: number; view: View }
  | { mode: 'move'; id: string; startX: number; startY: number; ox: number; oy: number }
  | { mode: 'draw'; type: ShapeType; startX: number; startY: number; x: number; y: number; w: number; h: number }
  | { mode: 'resize'; id: string; corner: number; start: Shape }

const HANDLE_CORNERS = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
] as const

export function Canvas({
  shapes,
  selectedId,
  tool,
  onSelect,
  onToolChange,
  onCreate,
  onUpdate,
}: CanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 })
  const [drag, setDrag] = useState<Drag | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const dragRef = useRef<Drag | null>(null)
  dragRef.current = drag

  const toScene = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect()
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
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const pt = toScene(e.clientX, e.clientY)

    if (tool === 'hand' || e.button === 1) {
      setDragBoth({ mode: 'pan', startX: e.clientX, startY: e.clientY, view })
      return
    }

    if (tool === 'select') {
      const target = (e.target as Element).closest('[data-shape-id]')
      const id = target?.getAttribute('data-shape-id') ?? null
      onSelect(id)
      if (id) {
        const s = shapes.find((sh) => sh.id === id)!
        setDragBoth({ mode: 'move', id, startX: pt.x, startY: pt.y, ox: s.x, oy: s.y })
      }
      return
    }

    // shape tools: drag out a new shape
    setDragBoth({ mode: 'draw', type: tool, startX: pt.x, startY: pt.y, x: pt.x, y: pt.y, w: 0, h: 0 })
  }

  const startResize = (e: React.PointerEvent, corner: number) => {
    e.stopPropagation()
    const s = shapes.find((sh) => sh.id === selectedId)
    if (!s) return
    svgRef.current!.setPointerCapture(e.pointerId)
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
      onUpdate(d.id, {
        x: Math.round(d.ox + pt.x - d.startX),
        y: Math.round(d.oy + pt.y - d.startY),
      })
    } else if (d.mode === 'draw') {
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
      // anchor is the corner opposite the one being dragged
      const ax = start.x + (1 - cx) * start.w
      const ay = start.y + (1 - cy) * start.h
      onUpdate(d.id, {
        x: Math.round(Math.min(ax, pt.x)),
        y: Math.round(Math.min(ay, pt.y)),
        w: Math.max(1, Math.round(Math.abs(pt.x - ax))),
        h: Math.max(1, Math.round(Math.abs(pt.y - ay))),
      })
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
      onSelect(shape.id)
      onToolChange('select')
      if (d.type === 'text') setEditingId(shape.id)
    }
    setDragBoth(null)
  }

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const rect = svgRef.current!.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const factor = Math.exp(-e.deltaY * 0.01)
      setView((v) => {
        const scale = Math.min(4, Math.max(0.2, v.scale * factor))
        const k = scale / v.scale
        return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k }
      })
    } else {
      setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
    }
  }

  const selected = shapes.find((s) => s.id === selectedId)
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
    <svg
      ref={svgRef}
      className="h-full w-full touch-none select-none bg-cx-canvas"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
      onDoubleClick={(e) => {
        const target = (e.target as Element).closest('[data-shape-id]')
        const id = target?.getAttribute('data-shape-id')
        const s = shapes.find((sh) => sh.id === id)
        if (s?.type === 'text') setEditingId(s.id)
      }}
    >
      <defs>
        <pattern
          id="cx-dots"
          width={dot}
          height={dot}
          patternUnits="userSpaceOnUse"
          x={view.x % dot}
          y={view.y % dot}
        >
          <circle cx={1} cy={1} r={1} fill="var(--cx-dot)" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#cx-dots)" />

      <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
        {renderOrder(shapes).map((s) => (
          <ShapeView key={s.id} shape={s} hideText={s.id === editingId} />
        ))}

        {drag?.mode === 'draw' && (drag.w > 4 || drag.h > 4) && (
          <rect
            x={drag.x}
            y={drag.y}
            width={drag.w}
            height={drag.h}
            fill="none"
            stroke="var(--cx-accent)"
            strokeWidth={1 / view.scale}
            strokeDasharray={`${4 / view.scale} ${3 / view.scale}`}
          />
        )}

        {selected && !editingId && (
          <g>
            <rect
              x={selected.x}
              y={selected.y}
              width={selected.w}
              height={selected.h}
              fill="none"
              stroke="var(--cx-accent)"
              strokeWidth={1.5 / view.scale}
              pointerEvents="none"
            />
            {HANDLE_CORNERS.map(([cx, cy], i) => (
              <rect
                key={i}
                x={selected.x + cx * selected.w - 4 / view.scale}
                y={selected.y + cy * selected.h - 4 / view.scale}
                width={8 / view.scale}
                height={8 / view.scale}
                fill="#ffffff"
                stroke="var(--cx-accent)"
                strokeWidth={1.5 / view.scale}
                style={{ cursor: i % 2 === 0 ? 'nwse-resize' : 'nesw-resize' }}
                onPointerDown={(e) => startResize(e, i)}
              />
            ))}
            <text
              x={selected.x}
              y={selected.y + selected.h + 16 / view.scale}
              fontSize={11 / view.scale}
              fontFamily="var(--font-mono)"
              fill="var(--cx-accent)"
              pointerEvents="none"
            >
              {`${selected.x}, ${selected.y} · ${selected.w} × ${selected.h}`}
            </text>
          </g>
        )}

        {editing && (
          <foreignObject
            x={editing.x}
            y={editing.y}
            width={Math.max(editing.w, 40)}
            height={Math.max(editing.h, 32)}
          >
            <input
              autoFocus
              defaultValue={editing.text}
              className="h-full w-full bg-transparent outline-none"
              style={{
                font: `${editing.fontSize ?? 20}px var(--font-sans)`,
                color: editing.fill,
              }}
              onBlur={(e) => {
                onUpdate(editing.id, { text: e.target.value })
                setEditingId(null)
              }}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
              }}
              onPointerDown={(e) => e.stopPropagation()}
            />
          </foreignObject>
        )}
      </g>

      <text
        x={16}
        y="99%"
        fontSize={11}
        fontFamily="var(--font-mono)"
        fill="var(--color-muted-foreground)"
      >
        {`${Math.round(view.scale * 100)}%`}
      </text>
    </svg>
  )
}

function ShapeView({ shape: s, hideText }: { shape: Shape; hideText?: boolean }) {
  const common = {
    'data-shape-id': s.id,
    opacity: s.opacity,
    stroke: s.stroke ?? 'rgba(0,0,0,0.12)',
    strokeWidth: s.stroke ? (s.strokeWidth ?? 1) : 1,
  }
  if (s.type === 'ellipse') {
    return (
      <ellipse
        {...common}
        cx={s.x + s.w / 2}
        cy={s.y + s.h / 2}
        rx={s.w / 2}
        ry={s.h / 2}
        fill={s.fill}
      />
    )
  }
  if (s.type === 'text') {
    return (
      <text
        data-shape-id={s.id}
        opacity={s.opacity}
        x={s.x}
        y={s.y + (s.fontSize ?? 20)}
        fontSize={s.fontSize ?? 20}
        fontFamily="var(--font-sans)"
        fill={hideText ? 'transparent' : s.fill}
      >
        {s.text}
      </text>
    )
  }
  if (s.type === 'frame') {
    return (
      <g data-shape-id={s.id} opacity={s.opacity}>
        <text
          x={s.x}
          y={s.y - 8}
          fontSize={12}
          fontFamily="var(--font-mono)"
          fill="var(--color-muted-foreground)"
        >
          {s.text ?? 'Frame'}
        </text>
        <rect
          x={s.x}
          y={s.y}
          width={s.w}
          height={s.h}
          rx={s.radius ?? 0}
          fill={s.fill}
          stroke={s.stroke ?? 'var(--cx-dot)'}
          strokeWidth={s.strokeWidth ?? 1}
        />
      </g>
    )
  }
  return (
    <rect
      {...common}
      x={s.x}
      y={s.y}
      width={s.w}
      height={s.h}
      rx={s.radius ?? 0}
      fill={s.fill}
    />
  )
}
