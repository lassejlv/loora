import type { CanvasColor } from '@loora/canvas/model'

export interface VectorDescriptor {
  viewBox: string
  paths: {
    d: string
    fill?: CanvasColor
    stroke?: CanvasColor
    strokeWidth?: number
  }[]
}

const ICON_DEFAULT_COLOR = '#111827'

function svgNumber(value: string | undefined, fallback = 0) {
  const parsed = Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) ? parsed : fallback
}

function safeColor(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'none' || trimmed === 'transparent') return undefined
  if (trimmed === 'currentColor') return ICON_DEFAULT_COLOR
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) return trimmed
  if (/^[a-z]+$/i.test(trimmed)) return trimmed
  if (/^(?:rgb|rgba|hsl|hsla)\([0-9a-z.%+,\s/-]+\)$/i.test(trimmed)) return trimmed
  return undefined
}

export function shapePathData(
  tag: string,
  attributes: Record<string, string>,
): string | null {
  if (tag === 'path' && attributes.d) return attributes.d
  if (tag === 'circle') {
    const cx = svgNumber(attributes.cx)
    const cy = svgNumber(attributes.cy)
    const r = svgNumber(attributes.r)
    if (r <= 0) return null
    return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`
  }
  if (tag === 'ellipse') {
    const cx = svgNumber(attributes.cx)
    const cy = svgNumber(attributes.cy)
    const rx = svgNumber(attributes.rx)
    const ry = svgNumber(attributes.ry)
    if (rx <= 0 || ry <= 0) return null
    return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0`
  }
  if (tag === 'rect') {
    const x = svgNumber(attributes.x)
    const y = svgNumber(attributes.y)
    const width = svgNumber(attributes.width)
    const height = svgNumber(attributes.height)
    const rx = Math.min(svgNumber(attributes.rx), width / 2)
    const ry = Math.min(
      svgNumber(attributes.ry, svgNumber(attributes.rx)),
      height / 2,
    )
    if (width <= 0 || height <= 0) return null
    if (rx <= 0 && ry <= 0) {
      return `M ${x} ${y} h ${width} v ${height} h ${-width} z`
    }
    return [
      `M ${x + rx} ${y}`,
      `H ${x + width - rx}`,
      `A ${rx} ${ry} 0 0 1 ${x + width} ${y + ry}`,
      `V ${y + height - ry}`,
      `A ${rx} ${ry} 0 0 1 ${x + width - rx} ${y + height}`,
      `H ${x + rx}`,
      `A ${rx} ${ry} 0 0 1 ${x} ${y + height - ry}`,
      `V ${y + ry}`,
      `A ${rx} ${ry} 0 0 1 ${x + rx} ${y}`,
      'Z',
    ].join(' ')
  }
  if (tag === 'line') {
    const x1 = svgNumber(attributes.x1)
    const y1 = svgNumber(attributes.y1)
    const x2 = svgNumber(attributes.x2)
    const y2 = svgNumber(attributes.y2)
    return `M ${x1} ${y1} L ${x2} ${y2}`
  }
  if (tag === 'polyline' || tag === 'polygon') {
    const points = (attributes.points || '')
      .trim()
      .split(/[\s,]+/)
      .map(Number.parseFloat)
      .filter(Number.isFinite)
    if (points.length < 4) return null
    const pairs: string[] = []
    for (let index = 0; index + 1 < points.length; index += 2) {
      pairs.push(`${points[index]} ${points[index + 1]}`)
    }
    const prefix = pairs.map((pair, index) =>
      index === 0 ? `M ${pair}` : `L ${pair}`,
    )
    if (tag === 'polygon') prefix.push('Z')
    return prefix.join(' ')
  }
  return null
}

const DRAWABLE_TAGS = new Set([
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
])

/**
 * Parse a raw SVG string into the vector path data the canvas stores. Uses
 * DOMParser (the editor already relies on it for HTML import), supports the
 * same shape primitives as the HTML/CSS import pipeline, and inherits
 * `fill`/`stroke`/`stroke-width` through the subtree. `currentColor`
 * substitutes a visible neutral so icons are not invisible on a white canvas.
 */
export function svgStringToVectorDescriptor(svg: string): VectorDescriptor | null {
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  } catch {
    return null
  }
  const svgEl = doc.documentElement
  if (!svgEl || svgEl.tagName.toLowerCase() !== 'svg') return null

  const viewBox =
    svgEl.getAttribute('viewBox') ||
    (svgEl.getAttribute('width') && svgEl.getAttribute('height')
      ? `0 0 ${svgNumber(svgEl.getAttribute('width') ?? undefined)} ${svgNumber(svgEl.getAttribute('height') ?? undefined)}`
      : '0 0 24 24')

  const paths: VectorDescriptor['paths'] = []

  const visit = (
    element: Element,
    inherited: {
      fill?: string
      stroke?: string
      strokeWidth?: number
    },
  ) => {
    const tag = element.tagName.toLowerCase()
    const fill = safeColor(
      element.getAttribute('fill') ?? undefined,
    ) ?? inherited.fill
    const strokeColor =
      safeColor(element.getAttribute('stroke') ?? undefined) ?? inherited.stroke
    const ownStrokeWidth = Number.parseFloat(
      element.getAttribute('stroke-width') ?? '',
    )
    const strokeWidth = Number.isFinite(ownStrokeWidth)
      ? ownStrokeWidth
      : inherited.strokeWidth

    if (DRAWABLE_TAGS.has(tag)) {
      const attributes: Record<string, string> = {}
      for (const attr of Array.from(element.attributes)) {
        attributes[attr.name] = attr.value
      }
      const d = shapePathData(tag, attributes)
      if (d) {
        paths.push({
          d,
          ...(fill ? { fill } : {}),
          ...(strokeColor ? { stroke: strokeColor } : {}),
          ...(strokeWidth !== undefined ? { strokeWidth } : {}),
        })
      }
    }

    for (const child of Array.from(element.children)) {
      visit(child, {
        fill: fill ?? inherited.fill,
        stroke: strokeColor ?? inherited.stroke,
        strokeWidth,
      })
    }
  }

  visit(svgEl, {})

  if (paths.length === 0) return null
  return { viewBox, paths }
}

/**
 * Quick test of whether a pasted string looks like an SVG document. Used to
 * decide whether to try the SVG conversion path before falling back to plain
 * text paste.
 */
export function looksLikeSvg(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 5 || trimmed.length > 500_000) return false
  if (trimmed.startsWith('<svg')) return true
  const parser = new DOMParser()
  try {
    const doc = parser.parseFromString(trimmed, 'text/html')
    return !!doc.querySelector('svg')
  } catch {
    return false
  }
}

export { ICON_DEFAULT_COLOR }