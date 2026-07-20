import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { CanvasElement, ElementPatch } from '#/lib/canvas'
import { elementId } from '#/lib/canvas'
import { TEMPLATE_DEFAULTS, type InsertTool } from '#/lib/element-templates'
import { ElementFrame } from '#/components/element-frame'

export type Tool = 'select' | 'hand' | 'interact' | 'comment' | InsertTool

// A comment pin: the element it targets and the pin position inside it,
// as percentages of the element box.
export interface CommentTarget {
  element: CanvasElement
  px: number
  py: number
}

export function composeComment(text: string, target: CommentTarget): string {
  const { element, px, py } = target
  return [
    text,
    '',
    '---',
    'Canvas comment pinned to:',
    `- Element "${element.name}" (id: ${element.id}) at (${element.x}, ${element.y}), ${element.w}×${element.h}`,
    `- Pin location inside the element: ${px}% from the left, ${py}% from the top`,
  ].join('\n')
}

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
  elements: CanvasElement[]
  selectedIds: string[]
  tool: Tool
  docId?: string
  controlsRef?: React.RefObject<CanvasControls | null>
  onScaleChange?: (pct: number) => void
  onSelect: (ids: string[]) => void
  onToolChange: (tool: Tool) => void
  onCreate: (element: CanvasElement) => void
  onUpdateMany: (patches: ReadonlyMap<string, ElementPatch>) => void
  // Returns false when the message could not be sent (agent busy) so the
  // comment popover stays open instead of losing the user's text.
  onComment?: (text: string) => boolean | void
}

type Drag =
  | { mode: 'pan'; startX: number; startY: number; view: View }
  | {
      mode: 'move'
      startX: number
      startY: number
      origins: { id: string; ox: number; oy: number; w: number; h: number }[]
      movingIds: Set<string>
      bounds: { left: number; top: number; right: number; bottom: number }
    }
  | { mode: 'draw'; type: InsertTool; startX: number; startY: number; x: number; y: number; w: number; h: number }
  | { mode: 'marquee'; additive: boolean; startX: number; startY: number; x: number; y: number; w: number; h: number }
  | {
      mode: 'resize'
      corner: number
      // Selection bounding box at drag start; every origin scales with it.
      start: { x: number; y: number; w: number; h: number }
      origins: { id: string; x: number; y: number; w: number; h: number }[]
    }

const HANDLE_CORNERS = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
] as const

const MIN_SCALE = 0.1
const MAX_SCALE = 16

const DEFAULT_VIEW: View = { x: 0, y: 0, scale: 1 }

// null = nothing persisted for this doc yet (first open → auto-fit).
function loadView(docId?: string): View | null {
  if (!docId || typeof localStorage === 'undefined') return DEFAULT_VIEW
  try {
    const raw = localStorage.getItem(`loora:view:${docId}`)
    if (raw) {
      const v = JSON.parse(raw) as View
      if (Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.scale)) return v
    }
  } catch {
    // corrupt entry: fall through to default
  }
  return null
}

export function Canvas({
  elements,
  selectedIds,
  tool,
  docId,
  controlsRef,
  onScaleChange,
  onSelect,
  onToolChange,
  onCreate,
  onUpdateMany,
  onComment,
}: CanvasProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>(() => loadView(docId) ?? DEFAULT_VIEW)
  const needsInitialFit = useRef(loadView(docId) === null)
  // Holding space temporarily switches to the hand tool (Figma muscle memory).
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] })
  // Element currently in "interact" mode: its iframe receives pointer events
  // instead of the canvas. Entered by double-click, left by clicking out.
  const [interactiveId, setInteractiveId] = useState<string | null>(null)
  // Comment tool: hovered element outline + open comment draft, in viewport coords.
  const [commentHover, setCommentHover] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [commentDraft, setCommentDraft] = useState<{ x: number; y: number; target: CommentTarget } | null>(null)
  const commentInputRef = useRef<HTMLTextAreaElement>(null)
  const dragRef = useRef<Drag | null>(null)
  dragRef.current = drag
  const activeTool: Tool = spaceHeld ? 'hand' : tool
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])

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

  // Comment tool hit-test: the element under the pointer.
  const commentHit = (e: React.PointerEvent) => {
    const hitEl = (e.target as Element).closest('[data-element-id]')
    const id = hitEl?.getAttribute('data-element-id')
    const element = elements.find((el) => el.id === id)
    if (!hitEl || !element) return null
    return { element, hitEl }
  }

  const buildCommentTarget = (
    hit: { element: CanvasElement; hitEl: Element },
    e: React.PointerEvent,
  ): CommentTarget => {
    const rect = hit.hitEl.getBoundingClientRect()
    const px = Math.round(Math.min(100, Math.max(0, ((e.clientX - rect.left) / Math.max(rect.width, 1)) * 100)))
    const py = Math.round(Math.min(100, Math.max(0, ((e.clientY - rect.top) / Math.max(rect.height, 1)) * 100)))
    return { element: hit.element, px, py }
  }

  const submitComment = () => {
    const text = commentInputRef.current?.value.trim()
    if (!text || !commentDraft) return
    if (onComment?.(composeComment(text, commentDraft.target)) === false) return
    setCommentDraft(null)
    onToolChange('select')
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return
    // Clicks inside an interactive iframe never reach the canvas, so any
    // pointer down that lands here means the user clicked outside it.
    if (interactiveId) setInteractiveId(null)

    // Comment tool: click an element to pin a comment for the agent.
    // Empty canvas pans.
    if (activeTool === 'comment') {
      if (e.button === 0) {
        const hit = commentHit(e)
        if (hit) {
          const rect = rootRef.current!.getBoundingClientRect()
          setCommentDraft({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            target: buildCommentTarget(hit, e),
          })
          setCommentHover(null)
          return
        }
      }
      setCommentDraft(null)
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      setDragBoth({ mode: 'pan', startX: e.clientX, startY: e.clientY, view })
      return
    }

    // Interact tool: clicks on elements belong to their content (hover, buttons,
    // details, …) — never select or move. Empty canvas pans instead.
    if (activeTool === 'interact') {
      if (e.button === 0 && (e.target as Element).closest('[data-element-id]')) return
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      setDragBoth({ mode: 'pan', startX: e.clientX, startY: e.clientY, view })
      return
    }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const pt = toScene(e.clientX, e.clientY)

    if (activeTool === 'hand' || e.button === 1) {
      setDragBoth({ mode: 'pan', startX: e.clientX, startY: e.clientY, view })
      return
    }

    if (activeTool === 'select') {
      const target = (e.target as Element).closest('[data-element-id]')
      const id = target?.getAttribute('data-element-id') ?? null
      if (id) {
        // Clicking a grouped element acts on the whole group.
        const gid = elements.find((el) => el.id === id)?.groupId
        const member = gid ? elements.filter((el) => el.groupId === gid).map((el) => el.id) : [id]
        const memberSet = new Set(member)
        if (e.shiftKey) {
          onSelect(
            selectedIdSet.has(id)
              ? selectedIds.filter((i) => !memberSet.has(i))
              : [...new Set([...selectedIds, ...member])],
          )
          return
        }
        const ids = selectedIdSet.has(id) ? selectedIds : member
        if (ids !== selectedIds) onSelect(ids)
        const idSet = new Set(ids)
        const origins = elements
          .filter((el) => idSet.has(el.id))
          .map((el) => ({ id: el.id, ox: el.x, oy: el.y, w: el.w, h: el.h }))
        const bounds = origins.reduce(
          (box, origin) => ({
            left: Math.min(box.left, origin.ox),
            top: Math.min(box.top, origin.oy),
            right: Math.max(box.right, origin.ox + origin.w),
            bottom: Math.max(box.bottom, origin.oy + origin.h),
          }),
          { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
        )
        setDragBoth({ mode: 'move', startX: pt.x, startY: pt.y, origins, movingIds: idSet, bounds })
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

    // insert tools: drag out a new element
    setDragBoth({ mode: 'draw', type: activeTool, startX: pt.x, startY: pt.y, x: pt.x, y: pt.y, w: 0, h: 0 })
  }

  const startResize = (e: React.PointerEvent, corner: number) => {
    e.stopPropagation()
    const targets = elements.filter((c) => selectedIdSet.has(c.id))
    if (targets.length === 0) return
    const start = {
      x: Math.min(...targets.map((el) => el.x)),
      y: Math.min(...targets.map((el) => el.y)),
      w: Math.max(...targets.map((el) => el.x + el.w)) - Math.min(...targets.map((el) => el.x)),
      h: Math.max(...targets.map((el) => el.y + el.h)) - Math.min(...targets.map((el) => el.y)),
    }
    rootRef.current!.setPointerCapture(e.pointerId)
    setDragBoth({
      mode: 'resize',
      corner,
      start,
      origins: targets.map((el) => ({ id: el.id, x: el.x, y: el.y, w: el.w, h: el.h })),
    })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    // Comment tool: outline the element under the pointer.
    if (activeTool === 'comment' && !dragRef.current && !commentDraft) {
      const hit = commentHit(e)
      if (hit) {
        const rootRect = rootRef.current!.getBoundingClientRect()
        const r = hit.hitEl.getBoundingClientRect()
        const next = { x: r.left - rootRect.left, y: r.top - rootRect.top, w: r.width, h: r.height }
        setCommentHover((prev) =>
          prev && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h
            ? prev
            : next,
        )
      } else {
        setCommentHover(null)
      }
    }
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

      // Snap the selection bounding box to edges/centers of other elements.
      const left = d.bounds.left + dx
      const top = d.bounds.top + dy
      const right = d.bounds.right + dx
      const bottom = d.bounds.bottom + dy
      const threshold = 6 / view.scale
      const others = elements.filter((el) => !d.movingIds.has(el.id))

      let bestX: { corr: number; line: number } | null = null
      let bestY: { corr: number; line: number } | null = null
      for (const el of others) {
        for (const c of [el.x, el.x + el.w / 2, el.x + el.w]) {
          for (const t of [left, (left + right) / 2, right]) {
            const corr = c - t
            if (Math.abs(corr) <= threshold && (!bestX || Math.abs(corr) < Math.abs(bestX.corr))) {
              bestX = { corr, line: c }
            }
          }
        }
        for (const c of [el.y, el.y + el.h / 2, el.y + el.h]) {
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

      const patches = new Map<string, ElementPatch>()
      for (const o of d.origins) {
        patches.set(o.id, { x: Math.round(o.ox + dx), y: Math.round(o.oy + dy) })
      }
      onUpdateMany(patches)
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
      // Anchor: opposite corner, or the selection center when alt is held.
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
      w = Math.max(1, w)
      h = Math.max(1, h)
      const x = e.altKey ? ax - w / 2 : pt.x < ax ? ax - w : ax
      const y = e.altKey ? ay - h / 2 : pt.y < ay ? ay - h : ay
      // Scale every selected element with the box (Figma group resize).
      const kx = w / Math.max(start.w, 1e-6)
      const ky = h / Math.max(start.h, 1e-6)
      const patches = new Map<string, ElementPatch>()
      for (const o of d.origins) {
        patches.set(o.id, {
          x: Math.round(x + (o.x - start.x) * kx),
          y: Math.round(y + (o.y - start.y) * ky),
          w: Math.max(1, Math.round(o.w * kx)),
          h: Math.max(1, Math.round(o.h * ky)),
        })
      }
      onUpdateMany(patches)
    }
  }

  const onPointerUp = () => {
    const d = dragRef.current
    if (d?.mode === 'draw') {
      const dragged = d.w > 4 || d.h > 4
      const def = TEMPLATE_DEFAULTS[d.type]
      const element: CanvasElement = {
        id: elementId(),
        name: def.name,
        x: Math.round(dragged ? d.x : d.startX - def.w / 2),
        y: Math.round(dragged ? d.y : d.startY - def.h / 2),
        w: Math.round(dragged ? d.w : def.w),
        h: Math.round(dragged ? d.h : def.h),
        code: def.code,
      }
      onCreate(element)
      onSelect([element.id])
      onToolChange('select')
    }
    if (d?.mode === 'marquee') {
      const hits = elements
        .filter((el) => el.x < d.x + d.w && el.x + el.w > d.x && el.y < d.y + d.h && el.y + el.h > d.y)
        .map((el) => el.id)
      // A marquee touching any group member catches the whole group.
      const hitSet = new Set(hits)
      const groups = new Set(elements.filter((el) => hitSet.has(el.id) && el.groupId).map((el) => el.groupId))
      const expanded = [
        ...new Set([
          ...hits,
          ...elements.filter((el) => el.groupId && groups.has(el.groupId)).map((el) => el.id),
        ]),
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

  // Leaving the comment tool drops any hover outline and open draft.
  useEffect(() => {
    if (tool !== 'comment') {
      setCommentHover(null)
      setCommentDraft(null)
    }
  }, [tool])

  // Space = temporary hand tool while held.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      const target = e.target as HTMLElement
      if (target.closest?.('input, textarea, [contenteditable]')) return
      e.preventDefault()
      setSpaceHeld(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false)
    }
    const reset = () => setSpaceHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', reset)
    }
  }, [])

  // Escape leaves per-element interact mode (clicking outside also works).
  useEffect(() => {
    if (!interactiveId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInteractiveId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [interactiveId])

  // Per-doc pan/zoom: reload on doc switch, persist (debounced) on change.
  useEffect(() => {
    const stored = loadView(docId)
    needsInitialFit.current = stored === null
    setView(stored ?? DEFAULT_VIEW)
  }, [docId])

  // First open of a doc with no persisted view: frame its content.
  useEffect(() => {
    if (!needsInitialFit.current || elements.length === 0) return
    needsInitialFit.current = false
    zoomToBounds(elements, 1)
  }, [elements])
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

  const zoomToBounds = (targets: CanvasElement[], maxScale = MAX_SCALE) => {
    if (targets.length === 0) return
    const left = Math.min(...targets.map((el) => el.x))
    const top = Math.min(...targets.map((el) => el.y))
    const right = Math.max(...targets.map((el) => el.x + el.w))
    const bottom = Math.max(...targets.map((el) => el.y + el.h))
    const { w, h } = viewportSize()
    const pad = 64
    const scale = Math.min(
      maxScale,
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
      zoomToFit: () => zoomToBounds(elements),
      zoomToSelection: () => zoomToBounds(elements.filter((el) => selectedIds.includes(el.id))),
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
  const selectedElements = elements.filter((el) => selectedIdSet.has(el.id))
  const selBounds =
    selectedElements.length > 0
      ? {
          x: Math.min(...selectedElements.map((el) => el.x)),
          y: Math.min(...selectedElements.map((el) => el.y)),
          w:
            Math.max(...selectedElements.map((el) => el.x + el.w)) -
            Math.min(...selectedElements.map((el) => el.x)),
          h:
            Math.max(...selectedElements.map((el) => el.y + el.h)) -
            Math.min(...selectedElements.map((el) => el.y)),
        }
      : undefined
  const dot = 24 * view.scale
  const cursor =
    activeTool === 'hand'
      ? drag?.mode === 'pan'
        ? 'grabbing'
        : 'grab'
      : activeTool === 'select' || activeTool === 'interact'
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
        if (activeTool !== 'select') return
        const target = (e.target as Element).closest('[data-element-id]')
        const id = target?.getAttribute('data-element-id')
        const el = elements.find((c) => c.id === id)
        if (el) {
          setInteractiveId(el.id)
          onSelect([])
        }
      }}
    >
      {/* Scene: element iframes, scaled with the view. */}
      <div
        className="absolute top-0 left-0"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          transformOrigin: '0 0',
        }}
      >
        {elements.map((el) => (
          <ElementView
            key={el.id}
            element={el}
            interactive={el.id === interactiveId || activeTool === 'interact'}
          />
        ))}
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

          {selectedElements.map((el) => (
            <rect
              key={el.id}
              x={el.x}
              y={el.y}
              width={el.w}
              height={el.h}
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

          {selBounds && (
            <g>
              {selectedElements.length > 1 && (
                <rect
                  x={selBounds.x}
                  y={selBounds.y}
                  width={selBounds.w}
                  height={selBounds.h}
                  fill="none"
                  stroke="var(--cx-accent)"
                  strokeWidth={1 / view.scale}
                  strokeDasharray={`${4 / view.scale} ${3 / view.scale}`}
                />
              )}
              {HANDLE_CORNERS.map(([cx, cy], i) => (
                <rect
                  key={i}
                  x={selBounds.x + cx * selBounds.w - 4 / view.scale}
                  y={selBounds.y + cy * selBounds.h - 4 / view.scale}
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
                x={selBounds.x}
                y={selBounds.y + selBounds.h + 16 / view.scale}
                fontSize={11 / view.scale}
                fontFamily="var(--font-mono)"
                fill="var(--cx-accent)"
              >
                {`${Math.round(selBounds.x)}, ${Math.round(selBounds.y)} · ${Math.round(selBounds.w)} × ${Math.round(selBounds.h)}`}
              </text>
            </g>
          )}
        </g>
      </svg>

      {/* Comment tool: hovered element outline (viewport space). */}
      {activeTool === 'comment' && commentHover && !commentDraft && (
        <div
          className="pointer-events-none absolute border border-cx-accent bg-cx-accent/5"
          style={{
            left: commentHover.x,
            top: commentHover.y,
            width: commentHover.w,
            height: commentHover.h,
            borderRadius: 2,
          }}
        />
      )}

      {/* Comment draft popover, anchored at the click point. */}
      {commentDraft && (
        <div
          className="absolute z-10 w-72 rounded-xl border bg-card p-2 shadow-md"
          style={{
            left: Math.min(commentDraft.x, (rootRect?.width ?? 800) - 300),
            top: Math.min(commentDraft.y, (rootRect?.height ?? 600) - 160),
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="mb-1.5 truncate px-1 font-mono text-[11px] text-muted-foreground">
            {`${commentDraft.target.element.name} · ${commentDraft.target.px}%, ${commentDraft.target.py}%`}
          </div>
          <textarea
            ref={commentInputRef}
            autoFocus
            rows={3}
            placeholder="Tell the agent what to change here…"
            className="w-full resize-none rounded-md border bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') setCommentDraft(null)
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submitComment()
              }
            }}
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button
              type="button"
              className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
              onClick={() => setCommentDraft(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-md bg-cx-accent px-2.5 py-1 text-xs font-medium text-white hover:opacity-90"
              onClick={submitComment}
            >
              Send to agent
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const ElementView = memo(function ElementView({
  element: el,
  interactive,
}: {
  element: CanvasElement
  interactive?: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  const errorTimer = useRef<number | null>(null)

  // Compile failures mid-stream are expected (partial code); only surface an
  // error that survives for a moment. Success clears it immediately.
  const onFrameError = (message: string | null) => {
    if (errorTimer.current) {
      window.clearTimeout(errorTimer.current)
      errorTimer.current = null
    }
    if (message === null) setError(null)
    else errorTimer.current = window.setTimeout(() => setError(message), 600)
  }

  useEffect(
    () => () => {
      if (errorTimer.current) window.clearTimeout(errorTimer.current)
    },
    [],
  )

  return (
    <div style={{ position: 'absolute', left: el.x, top: el.y, width: el.w, height: el.h }}>
      <div
        className="pointer-events-none absolute flex items-center gap-1.5 font-mono"
        style={{
          top: -20,
          left: 0,
          fontSize: 12,
          whiteSpace: 'nowrap',
          color: interactive ? 'var(--cx-accent)' : 'var(--color-muted-foreground)',
        }}
      >
        {el.name}
        {interactive ? ' · interacting' : ''}
        {error && (
          <span title={error} className="max-w-72 truncate text-[#e8442e]">
            ● {error}
          </span>
        )}
      </div>
      <div className="h-full w-full overflow-hidden">
        <ElementFrame
          elementId={el.id}
          code={el.code}
          interactive={!!interactive}
          onError={onFrameError}
        />
      </div>
      {/* transparent hit layer so select/move/resize work; removed in interact mode */}
      {!interactive && <div data-element-id={el.id} className="absolute inset-0" />}
    </div>
  )
})
