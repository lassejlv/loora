import type { CanvasElement } from './canvas'

// Shared snapping math for canvas interactions (move, resize, draw). Snap
// targets are the edges and centers of other elements; rotated elements
// contribute their axis-aligned bounding box.

export interface SnapLines {
  xs: number[]
  ys: number[]
}

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

// Axis-aligned bounding box, accounting for rotation about the center.
export function elementAABB(el: Pick<CanvasElement, 'x' | 'y' | 'w' | 'h' | 'r'>): Box {
  const r = el.r ?? 0
  if (r % 360 === 0) {
    return { left: el.x, top: el.y, right: el.x + el.w, bottom: el.y + el.h }
  }
  const rad = (r * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const w = el.w * cos + el.h * sin
  const h = el.w * sin + el.h * cos
  const cx = el.x + el.w / 2
  const cy = el.y + el.h / 2
  return { left: cx - w / 2, top: cy - h / 2, right: cx + w / 2, bottom: cy + h / 2 }
}

export function collectSnapLines(
  elements: readonly CanvasElement[],
  excludeIds: ReadonlySet<string>,
): SnapLines {
  const xs: number[] = []
  const ys: number[] = []
  for (const el of elements) {
    if (excludeIds.has(el.id)) continue
    const box = elementAABB(el)
    xs.push(box.left, (box.left + box.right) / 2, box.right)
    ys.push(box.top, (box.top + box.bottom) / 2, box.bottom)
  }
  return { xs, ys }
}

interface AxisSnap {
  corr: number
  line: number
}

function bestAxisSnap(
  candidates: readonly number[],
  targets: readonly number[],
  threshold: number,
): AxisSnap | null {
  let best: AxisSnap | null = null
  for (const c of candidates) {
    for (const t of targets) {
      const corr = c - t
      if (Math.abs(corr) <= threshold && (!best || Math.abs(corr) < Math.abs(best.corr))) {
        best = { corr, line: c }
      }
    }
  }
  return best
}

export interface BoxSnapResult {
  dx: number
  dy: number
  vLine: number | null
  hLine: number | null
}

// Snap a moving box (edges + center on both axes) against the snap lines.
// Returns the correction to add to the box position and the guide lines hit.
export function snapBox(box: Box, lines: SnapLines, threshold: number): BoxSnapResult {
  const x = bestAxisSnap(lines.xs, [box.left, (box.left + box.right) / 2, box.right], threshold)
  const y = bestAxisSnap(lines.ys, [box.top, (box.top + box.bottom) / 2, box.bottom], threshold)
  return {
    dx: x ? x.corr : 0,
    dy: y ? y.corr : 0,
    vLine: x ? x.line : null,
    hLine: y ? y.line : null,
  }
}

export interface PointSnapResult {
  x: number
  y: number
  vLine: number | null
  hLine: number | null
}

// Snap a single point (a dragged resize handle or draw cursor). Pass
// snapX/snapY = false for the axis a handle does not move.
export function snapPoint(
  pt: { x: number; y: number },
  lines: SnapLines,
  threshold: number,
  { snapX = true, snapY = true }: { snapX?: boolean; snapY?: boolean } = {},
): PointSnapResult {
  const x = snapX ? bestAxisSnap(lines.xs, [pt.x], threshold) : null
  const y = snapY ? bestAxisSnap(lines.ys, [pt.y], threshold) : null
  return {
    x: x ? x.line : pt.x,
    y: y ? y.line : pt.y,
    vLine: x ? x.line : null,
    hLine: y ? y.line : null,
  }
}
