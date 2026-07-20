import type { CanvasElement } from './canvas'

export type AlignEdge = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom'

// Align the selected elements inside their shared bounding box.
export function alignElements(
  elements: CanvasElement[],
  ids: string[],
  edge: AlignEdge,
): CanvasElement[] {
  const selected = new Set(ids)
  const targets = elements.filter((el) => selected.has(el.id))
  if (targets.length < 2) return elements
  const left = Math.min(...targets.map((el) => el.x))
  const right = Math.max(...targets.map((el) => el.x + el.w))
  const top = Math.min(...targets.map((el) => el.y))
  const bottom = Math.max(...targets.map((el) => el.y + el.h))
  const cx = (left + right) / 2
  const cy = (top + bottom) / 2

  return elements.map((el) => {
    if (!selected.has(el.id)) return el
    switch (edge) {
      case 'left':
        return { ...el, x: Math.round(left) }
      case 'centerX':
        return { ...el, x: Math.round(cx - el.w / 2) }
      case 'right':
        return { ...el, x: Math.round(right - el.w) }
      case 'top':
        return { ...el, y: Math.round(top) }
      case 'centerY':
        return { ...el, y: Math.round(cy - el.h / 2) }
      case 'bottom':
        return { ...el, y: Math.round(bottom - el.h) }
    }
  })
}

// Space the selected elements evenly between the outermost two, which stay
// put. Needs at least three elements to have anything to distribute.
export function distributeElements(
  elements: CanvasElement[],
  ids: string[],
  axis: 'x' | 'y',
): CanvasElement[] {
  const selected = new Set(ids)
  const targets = elements.filter((el) => selected.has(el.id))
  if (targets.length < 3) return elements

  const pos = (el: CanvasElement) => (axis === 'x' ? el.x : el.y)
  const size = (el: CanvasElement) => (axis === 'x' ? el.w : el.h)
  const sorted = [...targets].sort((a, b) => pos(a) - pos(b) || size(b) - size(a))

  const start = pos(sorted[0])
  const end = Math.max(...sorted.map((el) => pos(el) + size(el)))
  const total = sorted.reduce((sum, el) => sum + size(el), 0)
  const gap = (end - start - total) / (sorted.length - 1)

  const positions = new Map<string, number>()
  let cursor = start
  for (const el of sorted) {
    positions.set(el.id, Math.round(cursor))
    cursor += size(el) + gap
  }

  return elements.map((el) => {
    const next = positions.get(el.id)
    if (next === undefined) return el
    return axis === 'x' ? { ...el, x: next } : { ...el, y: next }
  })
}
