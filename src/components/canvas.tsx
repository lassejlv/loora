import { useRef, useState } from 'react'
import type { Shape, ShapeType } from '#/lib/canvas'
import { LINE_HEIGHT, layoutText, renderOrder, shapeId } from '#/lib/canvas'
import { ComponentFrame } from '#/components/component-frame'

export type Tool = 'select' | 'hand' | ShapeType

interface View {
  x: number
  y: number
  scale: number
}

interface CanvasProps {
  shapes: Shape[]
  selectedIds: string[]
  tool: Tool
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

export function Canvas({
  shapes,
  selectedIds,
  tool,
  onSelect,
  onToolChange,
  onCreate,
  onUpdate,
}: CanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 })
  const [drag, setDrag] = useState<Drag | null>(null)
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] })
  const [editingId, setEditingId] = useState<string | null>(null)
  // Component shape currently in "interact" mode: its iframe receives pointer
  // events instead of the canvas. Entered by double-click, left by clicking out.
  const [interactiveId, setInteractiveId] = useState<string | null>(null)
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
    // Clicks inside an interactive iframe never reach the svg, so any pointer
    // down that lands here means the user clicked outside it.
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
        if (e.shiftKey) {
          onSelect(
            selectedIds.includes(id) ? selectedIds.filter((i) => i !== id) : [...selectedIds, id],
          )
          return
        }
        const ids = selectedIds.includes(id) ? selectedIds : [id]
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
      onSelect(d.additive ? [...new Set([...selectedIds, ...hits])] : hits)
    }
    setDragBoth(null)
    setGuides({ v: [], h: [] })
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

  const svgRect = svgRef.current?.getBoundingClientRect()
  const scene = {
    left: -view.x / view.scale,
    top: -view.y / view.scale,
    right: ((svgRect?.width ?? 2000) - view.x) / view.scale,
    bottom: ((svgRect?.height ?? 2000) - view.y) / view.scale,
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
        if (s?.type === 'component') {
          setInteractiveId(s.id)
          onSelect([])
        }
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
          <ShapeView
            key={s.id}
            shape={s}
            hideText={s.id === editingId}
            interactive={s.id === interactiveId}
          />
        ))}

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
              pointerEvents="none"
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
            pointerEvents="none"
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
            pointerEvents="none"
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
                style={{ cursor: i % 2 === 0 ? 'nwse-resize' : 'nesw-resize' }}
                onPointerDown={(e) => startResize(e, i)}
              />
            ))}
            <text
              x={single.x}
              y={single.y + single.h + 16 / view.scale}
              fontSize={11 / view.scale}
              fontFamily="var(--font-mono)"
              fill="var(--cx-accent)"
              pointerEvents="none"
            >
              {`${single.x}, ${single.y} · ${single.w} × ${single.h}`}
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
            <textarea
              autoFocus
              defaultValue={editing.text}
              className="h-full w-full resize-none bg-transparent outline-none"
              style={{
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

function ShapeView({
  shape: s,
  hideText,
  interactive,
}: {
  shape: Shape
  hideText?: boolean
  interactive?: boolean
}) {
  if (s.type === 'image') {
    return (
      <image
        data-shape-id={s.id}
        href={s.src}
        x={s.x}
        y={s.y}
        width={s.w}
        height={s.h}
        opacity={s.opacity}
        preserveAspectRatio="none"
      />
    )
  }
  if (s.type === 'component') {
    return (
      <g opacity={s.opacity}>
        <text
          x={s.x}
          y={s.y - 8}
          fontSize={12}
          fontFamily="var(--font-mono)"
          fill={interactive ? 'var(--cx-accent)' : 'var(--color-muted-foreground)'}
          pointerEvents="none"
        >
          {`⚛ ${s.text ?? 'Component'}${interactive ? ' · interacting (click outside to exit)' : ''}`}
        </text>
        <foreignObject x={s.x} y={s.y} width={s.w} height={s.h}>
          <div className="h-full w-full overflow-hidden rounded-md shadow-sm ring-1 ring-black/10">
            <ComponentFrame code={s.code ?? ''} interactive={!!interactive} />
          </div>
        </foreignObject>
        {/* transparent hit layer so select/move/resize work; removed in interact mode */}
        {!interactive && (
          <rect
            data-shape-id={s.id}
            x={s.x}
            y={s.y}
            width={s.w}
            height={s.h}
            fill="transparent"
          />
        )}
      </g>
    )
  }
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
    const fontSize = s.fontSize ?? 20
    const anchorX = s.align === 'center' ? s.x + s.w / 2 : s.align === 'right' ? s.x + s.w : s.x
    return (
      <g data-shape-id={s.id} opacity={s.opacity}>
        {/* invisible hit area so empty space in the box is clickable */}
        <rect x={s.x} y={s.y} width={s.w} height={s.h} fill="transparent" />
        <text
          fontSize={fontSize}
          fontWeight={s.fontWeight ?? 400}
          fontFamily="var(--font-sans)"
          fill={hideText ? 'transparent' : s.fill}
          textAnchor={s.align === 'center' ? 'middle' : s.align === 'right' ? 'end' : 'start'}
        >
          {layoutText(s).map((line, i) => (
            <tspan key={i} x={anchorX} y={s.y + fontSize + i * fontSize * LINE_HEIGHT}>
              {line}
            </tspan>
          ))}
        </text>
      </g>
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
