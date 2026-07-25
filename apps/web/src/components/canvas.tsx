import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CanvasElement, ElementPatch } from '#/lib/canvas'
import { applyTextEdits, elementId } from '#/lib/canvas'
import { TEMPLATE_DEFAULTS, type InsertTool } from '#/lib/element-templates'
import {
  awaitRenderResult,
  classifyCode,
  ElementFrame,
  getRenderResult,
  measureElement,
  readElementLogs,
  type FrameTextEdit,
} from '#/components/element-frame'
import { ImagePickerDialog } from '#/components/image-picker-dialog'
import { StyleEditorPanel } from '#/components/style-editor-panel'
import {
  insertNodeMarkup,
  interactiveElements,
  moveNodeMarkup,
  NEW_SECTION_MARKUP,
  removeNodeMarkup,
  replaceClassValue,
  replaceImageSource,
  visibleElements,
} from '#/lib/canvas'
import { collectSnapLines, elementAABB, snapBox, snapPoint, type SnapLines } from '#/lib/snap'

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

export interface CanvasContextMenuInfo {
  x: number
  y: number
  nextSelectedIds: string[]
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
  onCanvasContextMenu?: (info: CanvasContextMenuInfo) => void
  /** Ids hovered in the layers rail — outlined here so the two views stay linked. */
  hoveredIds?: string[]
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
      lines: SnapLines
    }
  | {
      mode: 'draw'
      type: InsertTool
      startX: number
      startY: number
      x: number
      y: number
      w: number
      h: number
      lines: SnapLines
    }
  | { mode: 'marquee'; additive: boolean; startX: number; startY: number; x: number; y: number; w: number; h: number }
  | {
      mode: 'resize'
      handle: number
      // Selection bounding box at drag start; every origin scales with it.
      start: { x: number; y: number; w: number; h: number }
      origins: { id: string; x: number; y: number; w: number; h: number }[]
      lines: SnapLines
      // Single-element selection keeps its rotation; pointer math runs in the
      // element's local (unrotated) space. 0 for multi-selections.
      rotation: number
    }
  | {
      mode: 'rotate'
      id: string
      center: { x: number; y: number }
      startAngle: number
      startR: number
    }

// [cx, cy] handle positions on the selection box: 4 corners then 4 edge
// midpoints (0.5 = that axis does not resize).
const RESIZE_HANDLES = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
  [0.5, 0],
  [1, 0.5],
  [0.5, 1],
  [0, 0.5],
] as const

const HANDLE_CURSORS = [
  'nwse-resize',
  'nesw-resize',
  'nwse-resize',
  'nesw-resize',
  'ns-resize',
  'ew-resize',
  'ns-resize',
  'ew-resize',
] as const

// Rotate a point around a center by deg degrees.
function rotatePoint(pt: { x: number; y: number }, center: { x: number; y: number }, deg: number) {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = pt.x - center.x
  const dy = pt.y - center.y
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
}

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
  onCanvasContextMenu,
  hoveredIds,
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
  // Element whose runtime console is open (opened from its error badge).
  const [consoleFor, setConsoleFor] = useState<string | null>(null)
  // Inline text editing inside an interactive element: which element is in
  // edit mode, a notice for unmappable edits, and per-element remount nonces
  // to revert a frame whose DOM diverged from the code.
  const [textEditFor, setTextEditFor] = useState<string | null>(null)
  const [editNotice, setEditNotice] = useState<string | null>(null)
  const editNoticeTimer = useRef<number | null>(null)
  const [frameNonces, setFrameNonces] = useState<Record<string, number>>({})
  // An image clicked in an edit-mode frame, waiting for a replacement asset.
  const [imagePick, setImagePick] = useState<{ id: string; src: string } | null>(null)
  // A node right-clicked in an edit-mode frame, being styled.
  const [stylePick, setStylePick] = useState<{
    id: string
    tag: string
    className: string
    node: string
  } | null>(null)
  const elementsRef = useRef(elements)
  elementsRef.current = elements
  const dragRef = useRef<Drag | null>(null)
  dragRef.current = drag
  // Touch pinch-zoom: active touch pointers and the current pinch gesture.
  const touchPoints = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ dist: number; center: { x: number; y: number } } | null>(null)
  // Set when a doc switch just loaded a persisted view, so the debounced save
  // does not persist the previous doc's pan/zoom under the new doc id.
  const skipViewSave = useRef(false)
  const activeTool: Tool = spaceHeld ? 'hand' : tool
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const hoveredIdSet = useMemo(() => new Set(hoveredIds ?? []), [hoveredIds])
  // Hidden elements leave the scene entirely; locked ones stay on screen but
  // are invisible to hit-testing, marquee and every drag.
  const shownElements = useMemo(() => visibleElements(elements), [elements])
  const hitElements = useMemo(() => interactiveElements(elements), [elements])
  const isLocked = (id: string) => elements.find((el) => el.id === id)?.locked === true

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

  // Right-click: group-atomic select (or clear), then let the Editor menu open.
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    if (interactiveId) setInteractiveId(null)
    const pt = toScene(e.clientX, e.clientY)
    const target = (e.target as Element).closest('[data-element-id]')
    const id = target?.getAttribute('data-element-id')
    let nextSelectedIds: string[]
    if (id) {
      const gid = elements.find((el) => el.id === id)?.groupId
      const member = gid ? elements.filter((el) => el.groupId === gid).map((el) => el.id) : [id]
      nextSelectedIds = selectedIdSet.has(id) ? selectedIds : member
      if (nextSelectedIds !== selectedIds) onSelect(nextSelectedIds)
    } else {
      nextSelectedIds = []
      if (selectedIds.length > 0) onSelect([])
    }
    onCanvasContextMenu?.({ x: pt.x, y: pt.y, nextSelectedIds })
  }

  const rootPoint = (e: React.PointerEvent) => {
    const rect = rootRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const showNotice = useCallback((message: string) => {
    setEditNotice(message)
    if (editNoticeTimer.current) window.clearTimeout(editNoticeTimer.current)
    editNoticeTimer.current = window.setTimeout(() => setEditNotice(null), 6000)
  }, [])

  // Inline text edits from an interactive frame: map onto the source, apply
  // through the normal mutation path (undo, persistence). Unmappable edits
  // remount the frame so its DOM snaps back to the code.
  const handleTextEdit = useCallback(
    (id: string, edits: FrameTextEdit[]) => {
      const el = elementsRef.current.find((c) => c.id === id)
      if (!el) return
      const result = applyTextEdits(el.code, edits)
      if (!result.ok) {
        setFrameNonces((n) => ({ ...n, [id]: (n[id] ?? 0) + 1 }))
        showNotice(
          'Could not map that edit onto the code (the text may repeat or be generated). Use Edit code instead.',
        )
        return
      }
      onUpdateMany(new Map([[id, { code: result.code }]]))
    },
    [onUpdateMany, showNotice],
  )

  const toggleTextEdit = useCallback((id: string) => {
    setTextEditFor((current) => (current === id ? null : id))
  }, [])

  const handleImagePick = useCallback((id: string, src: string) => {
    setImagePick({ id, src })
  }, [])

  const handleNodeMove = useCallback(
    (id: string, move: { node: string; anchor: string; position: 'before' | 'after' }) => {
      const el = elementsRef.current.find((c) => c.id === id)
      if (!el) return
      if (classifyCode(el.code) !== 'html') {
        showNotice('Drag-reorder works in HTML blocks — this block is React code; ask the agent to move it.')
        return
      }
      const result = moveNodeMarkup(el.code, move.node, move.anchor, move.position)
      if (!result.ok) {
        showNotice('Could not map that move onto the code. Use Edit code or ask the agent instead.')
        return
      }
      onUpdateMany(new Map([[id, { code: result.code }]]))
    },
    [onUpdateMany, showNotice],
  )

  const handleStylePick = useCallback(
    (id: string, pick: { tag: string; className: string; node: string }) => {
      const el = elementsRef.current.find((c) => c.id === id)
      const structural = el ? classifyCode(el.code) === 'html' : false
      if (!pick.className && !structural) {
        showNotice('That part has no classes to edit — style it via Edit code or the agent.')
        return
      }
      setStylePick({ id, ...pick })
    },
    [showNotice],
  )

  const applyStyle = (prev: string, next: string) => {
    const pick = stylePick
    if (!pick) return
    const el = elementsRef.current.find((c) => c.id === pick.id)
    if (!el) return
    const result = replaceClassValue(el.code, prev, next)
    if (!result.ok) {
      setStylePick(null)
      showNotice('Could not find those classes in the code (they may be generated). Use Edit code instead.')
      return
    }
    onUpdateMany(new Map([[pick.id, { code: result.code }]]))
    // Keep the node markup in sync so structural actions still match.
    const nodeNext = replaceClassValue(pick.node, prev, next)
    setStylePick({ ...pick, className: next, node: nodeNext.ok ? nodeNext.code : pick.node })
  }

  // Structural actions from the style panel: delete/duplicate/add-section.
  // Each closes the panel — the node markup it captured is stale afterwards.
  const applyStructure = (mutate: (code: string, node: string) => ReturnType<typeof removeNodeMarkup>) => {
    const pick = stylePick
    setStylePick(null)
    if (!pick) return
    const el = elementsRef.current.find((c) => c.id === pick.id)
    if (!el) return
    const result = mutate(el.code, pick.node)
    if (!result.ok) {
      showNotice('Could not map that change onto the code. Use Edit code or ask the agent instead.')
      return
    }
    onUpdateMany(new Map([[pick.id, { code: result.code }]]))
    // Added/duplicated content usually grows the page past the element box,
    // where it would clip; grow the element to fit once the frame settles.
    void awaitRenderResult(pick.id, 3000).then(async (render) => {
      if (!render?.ok) return
      const size = await measureElement(pick.id)
      const current = elementsRef.current.find((c) => c.id === pick.id)
      if (size && current && size.h > current.h + 8) {
        onUpdateMany(new Map([[pick.id, { h: size.h }]]))
      }
    })
  }

  const replaceImage = (assetId: string) => {
    const pick = imagePick
    setImagePick(null)
    if (!pick) return
    const el = elementsRef.current.find((c) => c.id === pick.id)
    if (!el) return
    const result = replaceImageSource(el.code, pick.src, `/api/asset/${assetId}`)
    if (!result.ok) {
      showNotice('Could not find that image in the code — it may be generated. Use Edit code instead.')
      return
    }
    onUpdateMany(new Map([[pick.id, { code: result.code }]]))
  }

  useEffect(
    () => () => {
      if (editNoticeTimer.current) window.clearTimeout(editNoticeTimer.current)
    },
    [],
  )

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return
    // Clicks inside an interactive iframe never reach the canvas, so any
    // pointer down that lands here means the user clicked outside it.
    if (interactiveId) setInteractiveId(null)
    if (consoleFor) setConsoleFor(null)

    // Two touch pointers = pinch zoom; whatever drag the first finger started
    // is cancelled.
    if (e.pointerType === 'touch') {
      touchPoints.current.set(e.pointerId, rootPoint(e))
      if (touchPoints.current.size === 2) {
        const [a, b] = [...touchPoints.current.values()]
        pinchRef.current = {
          dist: Math.hypot(b.x - a.x, b.y - a.y),
          center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        }
        setDragBoth(null)
        setGuides({ v: [], h: [] })
        ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
        return
      }
      if (touchPoints.current.size > 2) return
    }

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
      const hitId = target?.getAttribute('data-element-id') ?? null
      // A locked element is scenery: the click falls through to the marquee.
      const id = hitId && !isLocked(hitId) ? hitId : null
      if (id) {
        // Clicking a grouped element acts on the whole group (locked members
        // stay out of it — they cannot be dragged along).
        const gid = elements.find((el) => el.id === id)?.groupId
        const member = gid ? hitElements.filter((el) => el.groupId === gid).map((el) => el.id) : [id]
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
        // Selecting a locked element from the layers rail is allowed; dragging
        // it is not, so the drag only ever carries the unlocked part.
        const targets = hitElements.filter((el) => idSet.has(el.id))
        if (targets.length === 0) return
        const origins = targets.map((el) => ({ id: el.id, ox: el.x, oy: el.y, w: el.w, h: el.h }))
        const bounds = targets.reduce(
          (box, el) => {
            const b = elementAABB(el)
            return {
              left: Math.min(box.left, b.left),
              top: Math.min(box.top, b.top),
              right: Math.max(box.right, b.right),
              bottom: Math.max(box.bottom, b.bottom),
            }
          },
          { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
        )
        setDragBoth({
          mode: 'move',
          startX: pt.x,
          startY: pt.y,
          origins,
          movingIds: new Set(targets.map((el) => el.id)),
          bounds,
          lines: collectSnapLines(elements, idSet),
        })
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
    setDragBoth({
      mode: 'draw',
      type: activeTool,
      startX: pt.x,
      startY: pt.y,
      x: pt.x,
      y: pt.y,
      w: 0,
      h: 0,
      lines: collectSnapLines(elements, new Set()),
    })
  }

  const startResize = (e: React.PointerEvent, handle: number) => {
    e.stopPropagation()
    const targets = hitElements.filter((c) => selectedIdSet.has(c.id))
    if (targets.length === 0) return
    // A single element resizes in its own (possibly rotated) local space;
    // multi-selections scale their axis-aligned bounding box.
    const single = targets.length === 1 ? targets[0] : null
    const start = single
      ? { x: single.x, y: single.y, w: single.w, h: single.h }
      : {
          x: Math.min(...targets.map((el) => elementAABB(el).left)),
          y: Math.min(...targets.map((el) => elementAABB(el).top)),
          w:
            Math.max(...targets.map((el) => elementAABB(el).right)) -
            Math.min(...targets.map((el) => elementAABB(el).left)),
          h:
            Math.max(...targets.map((el) => elementAABB(el).bottom)) -
            Math.min(...targets.map((el) => elementAABB(el).top)),
        }
    rootRef.current!.setPointerCapture(e.pointerId)
    setDragBoth({
      mode: 'resize',
      handle,
      start,
      origins: targets.map((el) => ({ id: el.id, x: el.x, y: el.y, w: el.w, h: el.h })),
      lines: collectSnapLines(elements, selectedIdSet),
      rotation: single ? (single.r ?? 0) : 0,
    })
  }

  const startRotate = (e: React.PointerEvent) => {
    e.stopPropagation()
    const targets = hitElements.filter((c) => selectedIdSet.has(c.id))
    if (targets.length !== 1) return
    const el = targets[0]
    const center = { x: el.x + el.w / 2, y: el.y + el.h / 2 }
    const pt = toScene(e.clientX, e.clientY)
    rootRef.current!.setPointerCapture(e.pointerId)
    setDragBoth({
      mode: 'rotate',
      id: el.id,
      center,
      startAngle: Math.atan2(pt.y - center.y, pt.x - center.x),
      startR: el.r ?? 0,
    })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    // Pinch zoom: scale around the moving midpoint, pan with it.
    if (e.pointerType === 'touch' && touchPoints.current.has(e.pointerId)) {
      touchPoints.current.set(e.pointerId, rootPoint(e))
      const pinch = pinchRef.current
      if (pinch && touchPoints.current.size >= 2) {
        const [a, b] = [...touchPoints.current.values()]
        const dist = Math.hypot(b.x - a.x, b.y - a.y)
        const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        if (pinch.dist > 0 && dist > 0) {
          const factor = dist / pinch.dist
          setView((v) => {
            const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor))
            const k = scale / v.scale
            return {
              scale,
              x: center.x - (pinch.center.x - v.x) * k,
              y: center.y - (pinch.center.y - v.y) * k,
            }
          })
        }
        pinchRef.current = { dist, center }
        return
      }
    }
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
    const threshold = 6 / view.scale
    if (d.mode === 'move') {
      let dx = pt.x - d.startX
      let dy = pt.y - d.startY

      // Snap the selection bounding box to edges/centers of other elements.
      const snapped = snapBox(
        {
          left: d.bounds.left + dx,
          top: d.bounds.top + dy,
          right: d.bounds.right + dx,
          bottom: d.bounds.bottom + dy,
        },
        d.lines,
        threshold,
      )
      dx += snapped.dx
      dy += snapped.dy
      setGuides({
        v: snapped.vLine !== null ? [snapped.vLine] : [],
        h: snapped.hLine !== null ? [snapped.hLine] : [],
      })

      const patches = new Map<string, ElementPatch>()
      for (const o of d.origins) {
        patches.set(o.id, { x: Math.round(o.ox + dx), y: Math.round(o.oy + dy) })
      }
      onUpdateMany(patches)
    } else if (d.mode === 'draw') {
      const snapped = snapPoint(pt, d.lines, threshold)
      setGuides({
        v: snapped.vLine !== null ? [snapped.vLine] : [],
        h: snapped.hLine !== null ? [snapped.hLine] : [],
      })
      setDragBoth({
        ...d,
        x: Math.min(d.startX, snapped.x),
        y: Math.min(d.startY, snapped.y),
        w: Math.abs(snapped.x - d.startX),
        h: Math.abs(snapped.y - d.startY),
      })
    } else if (d.mode === 'marquee') {
      setDragBoth({
        ...d,
        x: Math.min(d.startX, pt.x),
        y: Math.min(d.startY, pt.y),
        w: Math.abs(pt.x - d.startX),
        h: Math.abs(pt.y - d.startY),
      })
    } else if (d.mode === 'resize') {
      const [cx, cy] = RESIZE_HANDLES[d.handle]
      const moveX = cx !== 0.5
      const moveY = cy !== 0.5
      const { start } = d
      const center = { x: start.x + start.w / 2, y: start.y + start.h / 2 }
      // Rotated single element: work in its local (unrotated) space. Snapping
      // is skipped there — scene-space guide lines don't map onto a rotated box.
      const local = d.rotation % 360 !== 0 ? rotatePoint(pt, center, -d.rotation) : pt
      let px = local.x
      let py = local.y
      if (d.rotation % 360 === 0) {
        const snapped = snapPoint({ x: px, y: py }, d.lines, threshold, {
          snapX: moveX,
          snapY: moveY,
        })
        px = snapped.x
        py = snapped.y
        setGuides({
          v: snapped.vLine !== null ? [snapped.vLine] : [],
          h: snapped.hLine !== null ? [snapped.hLine] : [],
        })
      }
      // Anchor: opposite corner/edge, or the selection center when alt is held.
      const ax = e.altKey ? center.x : start.x + (1 - cx) * start.w
      const ay = e.altKey ? center.y : start.y + (1 - cy) * start.h
      const grow = e.altKey ? 2 : 1
      let w = moveX ? Math.abs(px - ax) * grow : start.w
      let h = moveY ? Math.abs(py - ay) * grow : start.h
      if (e.shiftKey && moveX && moveY && start.w > 0 && start.h > 0) {
        const ratio = start.w / start.h
        if (w / Math.max(h, 1e-6) > ratio) h = w / ratio
        else w = h * ratio
      }
      w = Math.max(1, w)
      h = Math.max(1, h)
      const x = !moveX ? start.x : e.altKey ? ax - w / 2 : px < ax ? ax - w : ax
      const y = !moveY ? start.y : e.altKey ? ay - h / 2 : py < ay ? ay - h : ay
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
    } else if (d.mode === 'rotate') {
      const angle = Math.atan2(pt.y - d.center.y, pt.x - d.center.x)
      let deg = d.startR + ((angle - d.startAngle) * 180) / Math.PI
      if (e.shiftKey) deg = Math.round(deg / 15) * 15
      deg = Math.round(((deg % 360) + 360) % 360)
      const patches = new Map<string, ElementPatch>()
      patches.set(d.id, { r: deg === 0 ? undefined : deg })
      onUpdateMany(patches)
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') {
      touchPoints.current.delete(e.pointerId)
      if (touchPoints.current.size < 2) pinchRef.current = null
    }
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
      const hits = hitElements
        .filter((el) => {
          const b = elementAABB(el)
          return b.left < d.x + d.w && b.right > d.x && b.top < d.y + d.h && b.bottom > d.y
        })
        .map((el) => el.id)
      // A marquee touching any group member catches the whole group.
      const hitSet = new Set(hits)
      const groups = new Set(hitElements.filter((el) => hitSet.has(el.id) && el.groupId).map((el) => el.groupId))
      const expanded = [
        ...new Set([
          ...hits,
          ...hitElements.filter((el) => el.groupId && groups.has(el.groupId)).map((el) => el.id),
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

  // Leaving interactivity drops text-edit mode so it doesn't silently resume
  // the next time the element becomes interactive.
  useEffect(() => {
    if (textEditFor && activeTool !== 'interact' && interactiveId !== textEditFor) {
      setTextEditFor(null)
    }
  }, [activeTool, interactiveId, textEditFor])

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
    skipViewSave.current = true
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
    // A doc switch re-runs this effect once with the previous doc's view but
    // the new docId; persisting that pair would clobber the new doc's view.
    if (skipViewSave.current) {
      skipViewSave.current = false
      return
    }
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
    const boxes = targets.map(elementAABB)
    const left = Math.min(...boxes.map((b) => b.left))
    const top = Math.min(...boxes.map((b) => b.top))
    const right = Math.max(...boxes.map((b) => b.right))
    const bottom = Math.max(...boxes.map((b) => b.bottom))
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
  // Chrome follows what is on screen: a hidden element draws no outline even
  // while selected, and an all-locked selection gets an outline but no handles.
  const selectedElements = shownElements.filter((el) => selectedIdSet.has(el.id))
  const selectionLocked =
    selectedElements.length > 0 && selectedElements.every((el) => el.locked === true)
  const hoveredElements = shownElements.filter(
    (el) => hoveredIdSet.has(el.id) && !selectedIdSet.has(el.id),
  )
  // A single selection keeps its own (possibly rotated) box so the handles
  // rotate with it; multi-selections use the axis-aligned union.
  const singleSelected = selectedElements.length === 1 ? selectedElements[0] : null
  const selRotation = singleSelected ? (singleSelected.r ?? 0) : 0
  const selBoxes = selectedElements.map(elementAABB)
  const selBounds = singleSelected
    ? { x: singleSelected.x, y: singleSelected.y, w: singleSelected.w, h: singleSelected.h }
    : selectedElements.length > 0
      ? {
          x: Math.min(...selBoxes.map((b) => b.left)),
          y: Math.min(...selBoxes.map((b) => b.top)),
          w: Math.max(...selBoxes.map((b) => b.right)) - Math.min(...selBoxes.map((b) => b.left)),
          h: Math.max(...selBoxes.map((b) => b.bottom)) - Math.min(...selBoxes.map((b) => b.top)),
        }
      : undefined
  // Label position uses the axis-aligned box so it never renders rotated.
  const selLabelBox =
    selectedElements.length > 0
      ? {
          left: Math.min(...selBoxes.map((b) => b.left)),
          bottom: Math.max(...selBoxes.map((b) => b.bottom)),
        }
      : undefined
  // Frames well outside the viewport get suspended: animations pause and rAF
  // work queues, so a big canvas doesn't burn CPU on invisible elements.
  const cullMargin = 300 / view.scale
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
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onContextMenu={onContextMenu}
      onDoubleClick={(e) => {
        if (activeTool !== 'select') return
        const target = (e.target as Element).closest('[data-element-id]')
        const id = target?.getAttribute('data-element-id')
        const el = hitElements.find((c) => c.id === id)
        if (el) {
          // Double-click means "edit the content": enter interact mode with
          // text/image editing on. The interact tool (i) stays pure play mode,
          // and the label chip toggles editing off for this element.
          setInteractiveId(el.id)
          setTextEditFor(el.id)
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
        {shownElements.map((el) => {
          const b = elementAABB(el)
          const offscreen =
            b.right < scene.left - cullMargin ||
            b.left > scene.right + cullMargin ||
            b.bottom < scene.top - cullMargin ||
            b.top > scene.bottom + cullMargin
          const interactive = el.id === interactiveId || activeTool === 'interact'
          return (
            <ElementView
              key={el.id}
              element={el}
              interactive={interactive}
              suspended={offscreen}
              textEditing={interactive && textEditFor === el.id}
              frameNonce={frameNonces[el.id] ?? 0}
              onOpenConsole={setConsoleFor}
              onToggleTextEdit={toggleTextEdit}
              onTextEdit={handleTextEdit}
              onImagePick={handleImagePick}
              onStylePick={handleStylePick}
              onNodeMove={handleNodeMove}
            />
          )
        })}
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

          {hoveredElements.map((el) => (
            <rect
              key={`hover-${el.id}`}
              x={el.x}
              y={el.y}
              width={el.w}
              height={el.h}
              fill="none"
              stroke="var(--cx-accent)"
              strokeOpacity={0.5}
              strokeWidth={1.5 / view.scale}
              transform={
                (el.r ?? 0) % 360 !== 0
                  ? `rotate(${el.r} ${el.x + el.w / 2} ${el.y + el.h / 2})`
                  : undefined
              }
            />
          ))}

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
              // A locked element reads as pinned, not grabbable.
              strokeDasharray={el.locked ? `${5 / view.scale} ${4 / view.scale}` : undefined}
              transform={
                (el.r ?? 0) % 360 !== 0
                  ? `rotate(${el.r} ${el.x + el.w / 2} ${el.y + el.h / 2})`
                  : undefined
              }
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
              <g
                transform={
                  selRotation % 360 !== 0
                    ? `rotate(${selRotation} ${selBounds.x + selBounds.w / 2} ${selBounds.y + selBounds.h / 2})`
                    : undefined
                }
              >
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
                {/* Rotate zones: invisible circles just outside each corner
                    (drawn first so the resize handles win where they overlap). */}
                {singleSelected &&
                  !selectionLocked &&
                  RESIZE_HANDLES.slice(0, 4).map(([cx, cy], i) => (
                    <circle
                      key={`rot${i}`}
                      cx={selBounds.x + cx * selBounds.w + (cx === 0 ? -1 : 1) * (12 / view.scale)}
                      cy={selBounds.y + cy * selBounds.h + (cy === 0 ? -1 : 1) * (12 / view.scale)}
                      r={9 / view.scale}
                      fill="transparent"
                      style={{ cursor: 'grab', pointerEvents: 'auto' }}
                      onPointerDown={startRotate}
                    />
                  ))}
                {!selectionLocked && RESIZE_HANDLES.map(([cx, cy], i) => (
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
                      cursor: HANDLE_CURSORS[i],
                      pointerEvents: 'auto',
                    }}
                    onPointerDown={(e) => startResize(e, i)}
                  />
                ))}
              </g>
              {selLabelBox && (
                <text
                  x={selLabelBox.left}
                  y={selLabelBox.bottom + 16 / view.scale}
                  fontSize={11 / view.scale}
                  fontFamily="var(--font-mono)"
                  fill="var(--cx-accent)"
                >
                  {`${Math.round(selBounds.x)}, ${Math.round(selBounds.y)} · ${Math.round(selBounds.w)} × ${Math.round(selBounds.h)}${selRotation % 360 !== 0 ? ` · ${Math.round(selRotation)}°` : ''}`}
                </text>
              )}
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

      {/* Image replacement picker (opened by clicking an image in edit mode). */}
      {imagePick && (
        <ImagePickerDialog
          onPick={(asset) => replaceImage(asset.id)}
          onClose={() => setImagePick(null)}
        />
      )}

      {/* Style editor (opened by right-clicking a node in edit mode). */}
      {stylePick && (
        <StyleEditorPanel
          key={`${stylePick.id}:${stylePick.tag}`}
          tag={stylePick.tag}
          className={stylePick.className}
          canStructure={
            !!stylePick.node &&
            classifyCode(elementsRef.current.find((c) => c.id === stylePick.id)?.code ?? '') === 'html'
          }
          onApply={applyStyle}
          onAddSection={(position) =>
            applyStructure((code, node) => insertNodeMarkup(code, node, NEW_SECTION_MARKUP, position))
          }
          onDuplicate={() => applyStructure((code, node) => insertNodeMarkup(code, node, node, 'after'))}
          onDelete={() => applyStructure((code, node) => removeNodeMarkup(code, node))}
          onClose={() => setStylePick(null)}
        />
      )}

      {/* Inline-edit notice (unmappable text edits). */}
      {editNotice && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
          <p
            role="status"
            className="max-w-xl rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground shadow-sm"
          >
            {editNotice}
          </p>
        </div>
      )}

      {/* Runtime console for an element, opened from its error badge. */}
      {consoleFor &&
        (() => {
          const el = elements.find((c) => c.id === consoleFor)
          if (!el) return null
          const b = elementAABB(el)
          const left = Math.max(8, Math.min(view.x + b.left * view.scale, (rootRect?.width ?? 800) - 356))
          const top = Math.max(8, Math.min(view.y + b.bottom * view.scale + 8, (rootRect?.height ?? 600) - 240))
          return (
            <ElementConsolePanel
              key={el.id}
              elementId={el.id}
              name={el.name}
              left={left}
              top={top}
              onClose={() => setConsoleFor(null)}
            />
          )
        })()}

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
  suspended,
  textEditing,
  frameNonce = 0,
  onOpenConsole,
  onToggleTextEdit,
  onTextEdit,
  onImagePick,
  onStylePick,
  onNodeMove,
}: {
  element: CanvasElement
  interactive?: boolean
  suspended?: boolean
  textEditing?: boolean
  frameNonce?: number
  onOpenConsole?: (id: string) => void
  onToggleTextEdit?: (id: string) => void
  onTextEdit?: (id: string, edits: FrameTextEdit[]) => void
  onImagePick?: (id: string, src: string) => void
  onStylePick?: (id: string, pick: { tag: string; className: string; node: string }) => void
  onNodeMove?: (id: string, move: { node: string; anchor: string; position: 'before' | 'after' }) => void
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
    <div
      style={{
        position: 'absolute',
        left: el.x,
        top: el.y,
        width: el.w,
        height: el.h,
        transform: (el.r ?? 0) % 360 !== 0 ? `rotate(${el.r}deg)` : undefined,
      }}
    >
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
        {interactive && (
          <button
            type="button"
            title="Click text to edit it, click an image to swap it, right-click anything for styles"
            className={
              textEditing
                ? 'pointer-events-auto cursor-pointer rounded-full bg-cx-accent px-1.5 text-[10px] font-medium text-white'
                : 'pointer-events-auto cursor-pointer rounded-full border px-1.5 text-[10px] text-muted-foreground hover:text-foreground'
            }
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onToggleTextEdit?.(el.id)
            }}
          >
            {textEditing ? 'done' : 'edit text'}
          </button>
        )}
        {error && (
          <button
            type="button"
            title={`${error} — click for the console`}
            className="pointer-events-auto max-w-72 cursor-pointer truncate text-[#e8442e]"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onOpenConsole?.(el.id)
            }}
          >
            ● {error}
          </button>
        )}
      </div>
      <div className="h-full w-full overflow-hidden">
        <ElementFrame
          key={`${el.id}:${frameNonce}`}
          elementId={el.id}
          code={el.code}
          interactive={!!interactive}
          suspended={!!suspended && !interactive}
          textEditable={!!textEditing}
          onError={onFrameError}
          onTextEdit={(edits) => onTextEdit?.(el.id, edits)}
          onImagePick={(src) => onImagePick?.(el.id, src)}
          onStylePick={(pick) => onStylePick?.(el.id, pick)}
          onNodeMove={(move) => onNodeMove?.(el.id, move)}
        />
      </div>
      {/* transparent hit layer so select/move/resize work; removed in interact mode */}
      {!interactive && <div data-element-id={el.id} className="absolute inset-0" />}
    </div>
  )
})

// Small floating console showing an element's latest render error and its
// runtime log buffer — the same data the agent reads via readElementLogs, so
// users can see why an element crashed without asking the agent.
function ElementConsolePanel({
  elementId,
  name,
  left,
  top,
  onClose,
}: {
  elementId: string
  name: string
  left: number
  top: number
  onClose: () => void
}) {
  const [logs, setLogs] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(true)
  const renderResult = getRenderResult(elementId)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const refresh = () => {
    setLoading(true)
    void readElementLogs(elementId).then((next) => {
      setLogs(next)
      setLoading(false)
    })
  }

  useEffect(() => {
    refresh()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementId])

  return (
    <div
      className="absolute z-10 flex w-[348px] flex-col gap-1.5 rounded-xl border bg-card p-2 shadow-md"
      style={{ left, top }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 px-1">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
          {name} · console
        </span>
        <button
          type="button"
          className="rounded px-1.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
          onClick={refresh}
        >
          Refresh
        </button>
        <button
          type="button"
          aria-label="Close console"
          className="rounded px-1.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      {renderResult?.error && (
        <p className="rounded-md bg-[#e8442e]/10 px-2 py-1.5 font-mono text-[11px] break-words text-[#e8442e]">
          {renderResult.error}
        </p>
      )}
      <div className="max-h-40 overflow-y-auto rounded-md bg-background px-2 py-1.5 font-mono text-[11px]">
        {loading && !logs ? (
          <p className="text-muted-foreground">Loading logs…</p>
        ) : logs === null ? (
          <p className="text-muted-foreground">The element frame did not respond.</p>
        ) : logs.length === 0 ? (
          <p className="text-muted-foreground">No console output since the code last mounted.</p>
        ) : (
          logs.map((line, i) => (
            <p key={i} className={cnLogLine(line)}>
              {line}
            </p>
          ))
        )}
      </div>
    </div>
  )
}

function cnLogLine(line: string) {
  if (line.startsWith('uncaught:') || line.startsWith('error:')) return 'break-words text-[#e8442e]'
  if (line.startsWith('warn:')) return 'break-words text-[#a16207]'
  return 'break-words text-muted-foreground'
}
