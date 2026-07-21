import type { CanvasElement } from './canvas'

/**
 * Element shown by /blockpage/$designId: the ?element match when it exists,
 * otherwise the largest element — on a canvas mixing pages and fragments,
 * the page is almost always the biggest box.
 */
export function pickBlockPageElement(
  elements: readonly CanvasElement[],
  elementParam: string | null,
): CanvasElement | null {
  if (elements.length === 0) return null
  const byParam = elementParam ? elements.find((el) => el.id === elementParam) : null
  return byParam ?? elements.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a))
}
