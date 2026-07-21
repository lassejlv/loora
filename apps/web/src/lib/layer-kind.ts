import type { CanvasElement } from '#/lib/canvas'

/** Visual kind for layers-list icons — not a storage type. */
export type LayerKind = 'image' | 'text' | 'box' | 'jsx' | 'html'

/**
 * Lightweight heuristics so the layers panel can show distinct icons without
 * pulling the element-frame compiler into the panel bundle.
 */
export function layerKind(element: Pick<CanvasElement, 'code' | 'name'>): LayerKind {
  const code = element.code
  const trimmed = code.trim()

  if (/\b(function|const|let|var|class)\s+App\b/.test(code)) return 'jsx'
  if (trimmed && !trimmed.startsWith('<') && !/^<!doctype/i.test(trimmed)) return 'jsx'
  if (/className=|<\/?[A-Z]|=\{/.test(trimmed)) return 'jsx'

  if (/<img\b/i.test(code) || /repeating-conic-gradient/.test(code)) return 'image'
  if (/^<(p|h[1-6]|span|label)\b/i.test(trimmed)) return 'text'
  if (
    /^<div\b/i.test(trimmed) &&
    trimmed.length < 240 &&
    !/<img\b/i.test(code) &&
    !/<svg\b/i.test(code)
  ) {
    return 'box'
  }

  return 'html'
}

export function layerKindLabel(kind: LayerKind): string {
  switch (kind) {
    case 'image':
      return 'Image'
    case 'text':
      return 'Text'
    case 'box':
      return 'Box'
    case 'jsx':
      return 'JSX'
    case 'html':
      return 'HTML'
  }
}
