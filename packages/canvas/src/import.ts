import {
  type CanvasDocument,
  type CanvasInteraction,
  type CanvasLayout,
  type CanvasNode,
  type CanvasShadow,
  type CanvasStyle,
  type FrameNode,
  type ImageNode,
  type NodeId,
  type SemanticTag,
  type TextNode,
  type VectorNode,
  assertDocument,
  canvasId,
  createCanvasDocument,
  createFrameNode,
  createPageNode,
  createTextNode,
  defaultLayout,
  defaultStyle,
  DEFAULT_ORDER_STEP,
} from './model'
import { TAILWIND_PREFLIGHT_CSS } from './tailwind-preflight'

export { TAILWIND_PREFLIGHT_CSS, TAILWIND_PREFLIGHT_VERSION } from './tailwind-preflight'

/**
 * Base CSS injected into the HTML import sandbox. Official Tailwind Preflight
 * plus Loora chrome so Paper snapshots measure with the same reset they were
 * authored against (`border: 0 solid`, unstyled lists/buttons, etc.).
 */
export const HTML_IMPORT_SANDBOX_BASE_CSS = [
  TAILWIND_PREFLIGHT_CSS,
  'html,body{min-height:100%}',
  'x-paper-html{display:inline-block}',
].join('')

export const MAX_HTML_IMPORT_NODES = 2_000

export interface HtmlCanvasRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Serializable DOM snapshot produced by the browser-side HTML importer.
 * Source markup and CSS never become part of the Canvas document.
 */
export interface HtmlCanvasSnapshot {
  tag: string
  text?: string
  attributes: Record<string, string>
  style: Record<string, string>
  rect: HtmlCanvasRect
  children: HtmlCanvasSnapshot[]
  /**
   * When the sandbox could not map a subtree to editable nodes (filters,
   * pseudos, path-less SVG), it may attach a PNG/JPEG data URL instead.
   */
  rasterDataUrl?: string
}

export interface HtmlCanvasImportInput {
  id: string
  name: string
  width: number
  height: number
  root: HtmlCanvasSnapshot
}

export interface HtmlCanvasImportResult {
  document: CanvasDocument
  pageId: NodeId
  warnings: string[]
}

const semanticTags = new Set<SemanticTag>([
  'div',
  'section',
  'header',
  'nav',
  'main',
  'footer',
  'article',
  'aside',
  'button',
  'a',
  'form',
])

const textTags = new Set([
  '#text',
  'abbr',
  'b',
  'blockquote',
  'cite',
  'code',
  'dd',
  'dt',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'i',
  'label',
  'li',
  'p',
  'pre',
  'q',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
])

function finite(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback
}

function numberStyle(
  style: Record<string, string>,
  name: string,
  fallback = 0,
) {
  const value = Number.parseFloat(style[name] ?? '')
  return Number.isFinite(value) ? value : fallback
}

function positiveDimension(value: number) {
  return Math.max(1, finite(value, 1))
}

function opacity(style: Record<string, string>) {
  return Math.min(1, Math.max(0, numberStyle(style, 'opacity', 1)))
}

function isTransparent(color: string | undefined) {
  if (!color) return true
  const normalized = color.replace(/\s+/g, '').toLowerCase()
  return (
    normalized === 'transparent' ||
    normalized === 'rgba(0,0,0,0)' ||
    normalized === 'rgb(0,0,0,0)' ||
    normalized === '#0000' ||
    normalized === '#00000000'
  )
}

/**
 * Pull a CSS color function/token out of a larger declaration. Handles nested
 * parentheses so `color(srgb … / 0.1)` survives.
 */
function matchCssColorToken(value: string): string | null {
  const start = value.search(
    /(?:rgba?|hsla?|oklab|oklch|lab|lch|color-mix|color)\(/i,
  )
  if (start >= 0) {
    let depth = 0
    for (let index = start; index < value.length; index += 1) {
      const character = value[index]
      if (character === '(') depth += 1
      else if (character === ')') {
        depth -= 1
        if (depth === 0) return value.slice(start, index + 1)
      }
    }
  }
  const hex = value.match(/#[0-9a-f]{3,8}\b/i)
  if (hex) return hex[0]
  const named = value.match(/\b([a-z]+)\b/i)
  return named?.[1] ?? null
}

function clampByte(value: number) {
  return Math.min(255, Math.max(0, Math.round(value)))
}

function splitCssList(value: string) {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === '(') depth += 1
    else if (character === ')') depth = Math.max(0, depth - 1)
    else if (character === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  parts.push(value.slice(start).trim())
  return parts.filter(Boolean)
}

/**
 * Paper emits `color(srgb …)` fills that fail Canvas validation. Convert the
 * common modern forms to rgb/rgba; leave already-valid colors alone.
 */
export function normalizeCssColor(value: string | undefined): string | undefined {
  if (!value) return undefined
  // Computed styles sometimes use NBSP / exotic spaces between tokens.
  const trimmed = value.replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, ' ').trim()
  if (!trimmed || isTransparent(trimmed)) return trimmed

  // light-dark(light, dark) — take the first resolvable color.
  const lightDark = trimmed.match(/^light-dark\(\s*([\s\S]+)\)$/i)
  if (lightDark) {
    for (const part of splitCssList(lightDark[1]!)) {
      const resolved = normalizeCssColor(part)
      if (resolved && !isTransparent(resolved)) return resolved
    }
  }

  const srgb = trimmed.match(
    /^color\(\s*srgb\s+([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)(?:\s*\/\s*([+-]?\d*\.?\d+%?))?\s*\)$/i,
  )
  if (srgb) {
    const r = clampByte(Number.parseFloat(srgb[1]!) * 255)
    const g = clampByte(Number.parseFloat(srgb[2]!) * 255)
    const b = clampByte(Number.parseFloat(srgb[3]!) * 255)
    let alpha = 1
    if (srgb[4] !== undefined) {
      const raw = srgb[4]
      alpha = raw.endsWith('%')
        ? Number.parseFloat(raw) / 100
        : Number.parseFloat(raw)
    }
    if (![r, g, b, alpha].every(Number.isFinite)) return undefined
    alpha = Math.min(1, Math.max(0, alpha))
    return alpha < 1
      ? `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(4))})`
      : `rgb(${r}, ${g}, ${b})`
  }

  if (
    /^#[0-9a-f]{3,8}$/i.test(trimmed) ||
    /^[a-z]+$/i.test(trimmed) ||
    /^(?:rgb|rgba|hsl|hsla|oklab|oklch|lab|lch)\(/i.test(trimmed)
  ) {
    return trimmed.slice(0, 200)
  }

  // Browser sandbox can resolve color-mix / remaining color() forms.
  if (typeof document !== 'undefined') {
    try {
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')
      if (context) {
        context.fillStyle = '#000000'
        context.fillStyle = trimmed
        const resolved = context.fillStyle
        if (resolved && resolved !== '#000000') {
          return String(resolved).slice(0, 200)
        }
        // fillStyle may keep #000000 for black inputs — verify by round-trip.
        if (/^(?:#000|#000000|black|rgb\(0,\s*0,\s*0\))$/i.test(trimmed)) {
          return String(resolved).slice(0, 200)
        }
        context.fillStyle = '#ffffff'
        context.fillStyle = trimmed
        if (context.fillStyle !== '#ffffff') {
          return String(context.fillStyle).slice(0, 200)
        }
      }
    } catch {
      // Fall through.
    }
  }

  if (/^color\(/i.test(trimmed) || /^color-mix\(/i.test(trimmed)) {
    return trimmed.slice(0, 200)
  }
  return undefined
}

/** True when a color string will pass Canvas `validColor`. */
function isCanvasSafeColor(value: string) {
  if (value.length > 200) return false
  return (
    /^#[0-9a-f]{3,8}$/i.test(value) ||
    /^-?[a-z]+(?:-[a-z0-9]+)*$/i.test(value) ||
    /^(?:rgb|rgba|hsl|hsla|oklab|oklch|lab|lch)\([0-9a-z.%+,\s/-]+\)$/i.test(
      value,
    ) ||
    /^color\([0-9a-z.%+,\s/()-]+\)$/i.test(value) ||
    /^color-mix\([0-9a-z.%+,\s/()#-]+\)$/i.test(value)
  )
}

function safeImportedColor(
  value: string | undefined,
  fallback?: string,
): string | undefined {
  const normalized = normalizeCssColor(value)
  if (!normalized || isTransparent(normalized)) return fallback
  if (isCanvasSafeColor(normalized)) return normalized
  return fallback
}

function solidPaint(color: string | undefined) {
  const normalized = safeImportedColor(color)
  if (!normalized) return []
  return [{ type: 'solid' as const, color: normalized }]
}

function cleanText(value: string) {
  return value.replace(/\r\n?/g, '\n').slice(0, 1_000_000)
}

function textWeight(value: string | undefined) {
  if (value === 'bold' || value === 'bolder') return 700
  if (value === 'normal' || value === 'lighter') return 400
  return numberStyle({ value: value ?? '' }, 'value', 400)
}

function textLineHeight(style: Record<string, string>, fontSize: number) {
  const raw = style.lineHeight
  if (!raw || raw === 'normal') return 1.2
  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value) || value <= 0) return 1.2
  return raw.endsWith('px') && fontSize > 0 ? value / fontSize : value
}

function textAlign(value: string | undefined) {
  return value === 'center' ||
    value === 'right' ||
    value === 'justify'
    ? value
    : 'left'
}

function textDecoration(value: string | undefined) {
  if (value?.includes('line-through')) return 'line-through' as const
  if (value?.includes('underline')) return 'underline' as const
  return 'none' as const
}

function textTransform(value: string | undefined) {
  return value === 'uppercase' ||
    value === 'lowercase' ||
    value === 'capitalize'
    ? value
    : 'none'
}

function radius(style: Record<string, string>): CanvasStyle['radius'] {
  const values = [
    numberStyle(style, 'borderTopLeftRadius'),
    numberStyle(style, 'borderTopRightRadius'),
    numberStyle(style, 'borderBottomRightRadius'),
    numberStyle(style, 'borderBottomLeftRadius'),
  ] as [number, number, number, number]
  return values.every((value) => value === values[0]) ? values[0] : values
}

function stroke(style: Record<string, string>): CanvasStyle['stroke'] {
  const sides = ['Top', 'Right', 'Bottom', 'Left'] as const
  const borders = sides.map((side) => ({
    width: numberStyle(style, `border${side}Width`),
    color: safeImportedColor(style[`border${side}Color`]),
    style: style[`border${side}Style`],
  }))
  const first = borders[0]!
  if (
    first.width <= 0 ||
    isTransparent(first.color) ||
    !first.color ||
    !['solid', 'dashed', 'dotted'].includes(first.style)
  ) {
    return undefined
  }
  if (
    !borders.every(
      (border) =>
        border.width === first.width &&
        border.color === first.color &&
        border.style === first.style,
    )
  ) {
    return undefined
  }
  return {
    width: first.width,
    color: first.color,
    style:
      first.style === 'dashed' || first.style === 'dotted'
        ? first.style
        : 'solid',
  }
}

function shadows(value: string | undefined): CanvasShadow[] {
  if (!value || value === 'none') return []
  const result: CanvasShadow[] = []
  for (const part of splitCssList(value).slice(0, 16)) {
    const rawColor = matchCssColorToken(part)
    // Skip named junk like `px` that matchCssColorToken can pull from length-only layers.
    const looksLikeColor =
      !!rawColor &&
      (/^(?:rgba?|hsla?|oklab|oklch|lab|lch|color-mix|color)\(/i.test(rawColor) ||
        rawColor.startsWith('#') ||
        (/^[a-z-]+$/i.test(rawColor) &&
          !['px', 'em', 'rem', 'pt', 'pc', 'in', 'cm', 'mm', 'vw', 'vh', 'deg', 'rad', 'turn', 'inset'].includes(
            rawColor.toLowerCase(),
          )))
    const resolved = looksLikeColor
      ? safeImportedColor(rawColor!)
      : undefined
    // Explicit transparent colors must stay droppable; only invent a fallback
    // when the layer had lengths and no color token at all.
    if (looksLikeColor && !resolved) continue
    const color = resolved ?? 'rgba(0, 0, 0, 0.2)'
    const lengths = part
      .replace(looksLikeColor && rawColor ? rawColor : '', '')
      .replace(/\binset\b/i, '')
      .match(/-?\d*\.?\d+(?:px)?/g)
      ?.map((item) => Number.parseFloat(item)) ?? []
    if (lengths.length < 2 || lengths.some((item) => !Number.isFinite(item))) {
      continue
    }
    const shadow: CanvasShadow = {
      x: lengths[0]!,
      y: lengths[1]!,
      blur: Math.max(0, lengths[2] ?? 0),
      spread: lengths[3] ?? 0,
      color,
      ...(part.includes('inset') ? { inset: true } : {}),
    }
    // Tailwind / Paper leave zero transparent layers in the stack — drop them.
    if (
      typeof shadow.color === 'string' &&
      isTransparent(shadow.color) &&
      shadow.x === 0 &&
      shadow.y === 0 &&
      shadow.blur === 0 &&
      shadow.spread === 0
    ) {
      continue
    }
    result.push(shadow)
  }
  return result
}

function parseGradientStops(body: string) {
  const stops: { offset: number; color: string }[] = []
  for (const part of splitCssList(body)) {
    const color = safeImportedColor(matchCssColorToken(part) ?? undefined)
    if (!color || isTransparent(color)) continue
    const percent = part.match(/(-?\d*\.?\d+)%/)
    const offset = percent
      ? Math.min(1, Math.max(0, Number.parseFloat(percent[1]!) / 100))
      : stops.length === 0
        ? 0
        : 1
    stops.push({ offset, color })
  }
  if (stops.length === 1) {
    stops.push({ offset: 1, color: stops[0]!.color })
  }
  return stops.length >= 2 ? stops : null
}

function parseLinearGradient(value: string) {
  const match = value.match(/linear-gradient\(\s*([\s\S]*)\)$/i)
  if (!match) return null
  const parts = splitCssList(match[1]!)
  if (parts.length < 2) return null
  let angle = 180
  let stopStart = 0
  const first = parts[0]!.trim().toLowerCase()
  if (first.endsWith('deg')) {
    angle = Number.parseFloat(first)
    stopStart = 1
  } else if (first.startsWith('to ')) {
    const map: Record<string, number> = {
      'to top': 0,
      'to right': 90,
      'to bottom': 180,
      'to left': 270,
      'to top right': 45,
      'to right top': 45,
      'to bottom right': 135,
      'to right bottom': 135,
      'to bottom left': 225,
      'to left bottom': 225,
      'to top left': 315,
      'to left top': 315,
    }
    angle = map[first] ?? 180
    stopStart = 1
  }
  const stops = parseGradientStops(parts.slice(stopStart).join(', '))
  if (!stops || !Number.isFinite(angle)) return null
  return {
    type: 'linear-gradient' as const,
    angle,
    stops,
  }
}

function parseRadialGradient(value: string) {
  const match = value.match(/radial-gradient\(\s*([\s\S]*)\)$/i)
  if (!match) return null
  const parts = splitCssList(match[1]!)
  if (parts.length < 2) return null
  let cx = 0.5
  let cy = 0.5
  let size: string | undefined
  let stopStart = 0
  const first = parts[0]!.trim()
  const at = first.match(/^(.*?)\s+at\s+(-?\d*\.?\d+)%\s+(-?\d*\.?\d+)%$/i)
  if (at) {
    size = at[1]!.trim() || undefined
    cx = Math.min(1, Math.max(0, Number.parseFloat(at[2]!) / 100))
    cy = Math.min(1, Math.max(0, Number.parseFloat(at[3]!) / 100))
    stopStart = 1
  } else if (/^(-?\d*\.?\d+)%\s+(-?\d*\.?\d+)%$/.test(first)) {
    const onlyAt = first.match(/^(-?\d*\.?\d+)%\s+(-?\d*\.?\d+)%$/)!
    cx = Math.min(1, Math.max(0, Number.parseFloat(onlyAt[1]!) / 100))
    cy = Math.min(1, Math.max(0, Number.parseFloat(onlyAt[2]!) / 100))
    stopStart = 1
  } else if (
    /^(circle|ellipse|closest-side|closest-corner|farthest-side|farthest-corner|[\d.%\s]+)$/i.test(
      first,
    ) &&
    !matchCssColorToken(first)
  ) {
    size = first
    stopStart = 1
  }
  const stops = parseGradientStops(parts.slice(stopStart).join(', '))
  if (!stops) return null
  return {
    type: 'radial-gradient' as const,
    cx,
    cy,
    ...(size ? { size: size.slice(0, 100) } : {}),
    stops,
  }
}

function backgroundPaints(style: Record<string, string>) {
  const paints: NonNullable<CanvasStyle['fills']> = []
  const image = style.backgroundImage?.trim()
  if (image && image !== 'none') {
    for (const layer of splitCssList(image)) {
      if (/^url\(/i.test(layer)) continue
      const linear = parseLinearGradient(layer)
      if (linear) {
        paints.push(linear)
        continue
      }
      const radial = parseRadialGradient(layer)
      if (radial) paints.push(radial)
    }
  }
  paints.push(...solidPaint(style.backgroundColor))
  return paints
}

function backgroundImageFit(style: Record<string, string>): ImageNode['fit'] {
  const size = (style.backgroundSize || '').toLowerCase()
  if (size === 'contain') return 'contain'
  if (size === '100% 100%' || size === '100%') return 'fill'
  return 'cover'
}

function backgroundImageOffset(style: Record<string, string>, width: number, height: number) {
  const position = style.backgroundPosition || '0% 0%'
  const parts = position.trim().split(/\s+/)
  const parse = (token: string | undefined, axis: number) => {
    if (!token || token === 'left' || token === 'top') return 0
    if (token === 'center') return axis * 0.5
    if (token === 'right' || token === 'bottom') return axis
    if (token.endsWith('%')) {
      return (Number.parseFloat(token) / 100) * axis
    }
    if (token.endsWith('px')) return Number.parseFloat(token)
    return 0
  }
  return {
    x: finite(parse(parts[0], width)),
    y: finite(parse(parts[1] ?? parts[0], height)),
  }
}

function rotation(value: string | undefined) {
  if (!value || value === 'none') return 0
  const rotate = value.match(/rotate\((-?\d*\.?\d+)deg\)/)
  if (rotate) return finite(Number.parseFloat(rotate[1] ?? ''), 0)
  const matrix = value.match(
    /^matrix\((-?\d*\.?\d+),\s*(-?\d*\.?\d+),/,
  )
  if (!matrix) return 0
  const a = Number.parseFloat(matrix[1] ?? '')
  const b = Number.parseFloat(matrix[2] ?? '')
  return finite((Math.atan2(b, a) * 180) / Math.PI, 0)
}

function align(value: string | undefined) {
  if (value === 'center') return 'center' as const
  if (value === 'flex-end' || value === 'end') return 'end' as const
  if (value === 'stretch') return 'stretch' as const
  return 'start' as const
}

function justify(value: string | undefined) {
  if (value === 'center') return 'center' as const
  if (value === 'flex-end' || value === 'end') return 'end' as const
  if (value === 'space-between') return 'space-between' as const
  if (value === 'space-around' || value === 'space-evenly') {
    return 'space-around' as const
  }
  return 'start' as const
}

function gridColumns(value: string | undefined) {
  if (!value || value === 'none') return 1
  const repeat = value.match(/^repeat\(\s*(\d+)\s*,/)
  if (repeat) return Math.max(1, Number.parseInt(repeat[1]!, 10))
  return Math.max(1, splitCssList(value.replaceAll(' ', ',')).length)
}

function mode(style: Record<string, string>) {
  if (style.display.includes('flex')) return 'flex' as const
  if (style.display.includes('grid')) return 'grid' as const
  return 'absolute' as const
}

function overflow(style: Record<string, string>) {
  const value = style.overflow || style.overflowX
  if (value === 'hidden' || value === 'clip') return 'hidden' as const
  if (value === 'auto' || value === 'scroll') return 'auto' as const
  return 'visible' as const
}

function frameStyle(style: Record<string, string>) {
  return defaultStyle({
    fills: backgroundPaints(style),
    stroke: stroke(style),
    radius: radius(style),
    shadows: shadows(style.boxShadow),
    opacity: opacity(style),
    overflow: overflow(style),
    ...(style.mixBlendMode &&
    style.mixBlendMode !== 'normal' &&
    [
      'multiply',
      'screen',
      'overlay',
      'darken',
      'lighten',
      'color-dodge',
      'color-burn',
      'hard-light',
      'soft-light',
      'difference',
      'exclusion',
      'hue',
      'saturation',
      'color',
      'luminosity',
    ].includes(style.mixBlendMode)
      ? { blendMode: style.mixBlendMode }
      : {}),
  })
}

function sanitizeFontFamily(value: string | undefined) {
  const raw = (value || 'Archivo').replace(/[\u00a0\u2000-\u200b]/g, ' ').trim()
  // Drop characters Canvas `safeCssText` rejects; keep the stack otherwise.
  const cleaned = raw
    .replace(/[{};<>\\\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 200)
  return cleaned || 'Archivo'
}

function textStyle(style: Record<string, string>) {
  const fontSize = Math.max(1, numberStyle(style, 'fontSize', 16))
  const fills = solidPaint(style.color)
  return defaultStyle({
    fills: fills.length > 0 ? fills : [{ type: 'solid' as const, color: '#000000' }],
    opacity: opacity(style),
    typography: {
      family: sanitizeFontFamily(style.fontFamily),
      size: fontSize,
      weight: textWeight(style.fontWeight),
      lineHeight: textLineHeight(style, fontSize),
      letterSpacing: numberStyle(style, 'letterSpacing'),
      align: textAlign(style.textAlign),
      wrap:
        style.whiteSpace !== 'nowrap' &&
        style.whiteSpace !== 'pre' &&
        style.textWrapMode !== 'nowrap',
      decoration: textDecoration(
        style.textDecorationLine || style.textDecoration,
      ),
      transform: textTransform(style.textTransform),
    },
  })
}

function safeUrl(value: string | undefined) {
  if (!value) return null
  if (/^data:image\/(?:png|jpeg|webp|gif|avif);base64,/i.test(value)) {
    return value
  }
  try {
    const parsed = new URL(value)
    if (
      parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' &&
        (parsed.hostname === 'localhost' ||
          parsed.hostname === '127.0.0.1'))
    ) {
      return parsed.toString()
    }
  } catch {
    // Relative and executable URLs are deliberately not imported.
  }
  return null
}

function backgroundImageUrl(value: string | undefined) {
  if (!value || value === 'none') return null
  const match = value.match(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^)'"]+))\s*\)/i)
  return safeUrl(match?.[1] || match?.[2] || match?.[3]?.trim())
}

function interactions(snapshot: HtmlCanvasSnapshot): CanvasInteraction[] {
  if (snapshot.tag !== 'a') return []
  const url = safeUrl(snapshot.attributes.href)
  if (!url) return []
  return [{
    trigger: 'click',
    actions: [{
      type: 'open-url',
      url,
      target:
        snapshot.attributes.target === '_blank' ? '_blank' : '_self',
    }],
  }]
}

function hasUnrepresentableFlowSpacing(style: Record<string, string>) {
  return [
    style.marginTop,
    style.marginRight,
    style.marginBottom,
    style.marginLeft,
  ].some((value) => value?.trim().toLowerCase() === 'auto')
}

function canFlow(snapshot: HtmlCanvasSnapshot) {
  const position = snapshot.style.position
  return (
    position !== 'absolute' &&
    position !== 'fixed' &&
    position !== 'sticky' &&
    !hasUnrepresentableFlowSpacing(snapshot.style)
  )
}

/**
 * How a container places its children. Absolute / fixed / sticky / margin:auto
 * children force the whole set absolute so measured positions stay honest.
 * Uniform non-zero margins no longer eject an otherwise clean flex/grid tree.
 */
function childArrangement(
  snapshot: HtmlCanvasSnapshot,
): 'absolute' | 'flex' | 'grid' {
  const ownMode = mode(snapshot.style)
  if (ownMode === 'absolute') return 'absolute'
  return snapshot.children.every(canFlow) ? ownMode : 'absolute'
}

/**
 * Where a child's absolute offset is measured from. The renderer positions an
 * absolute child against its parent's padding box and re-applies the same
 * border and padding this import captured, so an offset taken from the border
 * box lands one padding too far in on every level of nesting.
 */
export interface HtmlCanvasOrigin {
  x: number
  y: number
}

function childOrigin(
  snapshot: HtmlCanvasSnapshot,
  layout: CanvasLayout,
  style: CanvasStyle,
): HtmlCanvasOrigin {
  const border = style.stroke?.width ?? 0
  return {
    x: snapshot.rect.x + border + (layout.padding?.left ?? 0),
    y: snapshot.rect.y + border + (layout.padding?.top ?? 0),
  }
}

function nodeLayout(
  snapshot: HtmlCanvasSnapshot,
  parentOrigin: HtmlCanvasOrigin,
  parentMode: 'absolute' | 'flex' | 'grid',
  ownMode = childArrangement(snapshot),
) {
  const isFlow = parentMode !== 'absolute' && canFlow(snapshot)
  return defaultLayout(
    positiveDimension(snapshot.rect.width),
    positiveDimension(snapshot.rect.height),
    {
      position: isFlow ? 'flow' : 'absolute',
      x: isFlow ? 0 : finite(snapshot.rect.x - parentOrigin.x),
      y: isFlow ? 0 : finite(snapshot.rect.y - parentOrigin.y),
      mode: ownMode,
      direction:
        snapshot.style.flexDirection === 'column' ||
        snapshot.style.flexDirection === 'column-reverse'
          ? 'column'
          : 'row',
      wrap:
        snapshot.style.flexWrap === 'wrap' ||
        snapshot.style.flexWrap === 'wrap-reverse',
      gap: Math.max(
        0,
        numberStyle(
          snapshot.style,
          snapshot.style.flexDirection === 'column' ? 'rowGap' : 'columnGap',
          numberStyle(snapshot.style, 'gap'),
        ),
      ),
      padding: {
        top: Math.max(0, numberStyle(snapshot.style, 'paddingTop')),
        right: Math.max(0, numberStyle(snapshot.style, 'paddingRight')),
        bottom: Math.max(0, numberStyle(snapshot.style, 'paddingBottom')),
        left: Math.max(0, numberStyle(snapshot.style, 'paddingLeft')),
      },
      align: align(snapshot.style.alignItems),
      justify: justify(snapshot.style.justifyContent),
      ...(ownMode === 'grid'
        ? { columns: gridColumns(snapshot.style.gridTemplateColumns) }
        : {}),
    },
  )
}

function svgNumber(value: string | undefined, fallback = 0) {
  const parsed = Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) ? parsed : fallback
}

function shapePathData(node: HtmlCanvasSnapshot): string | null {
  if (node.tag === 'path' && node.attributes.d) return node.attributes.d
  if (node.tag === 'circle') {
    const cx = svgNumber(node.attributes.cx)
    const cy = svgNumber(node.attributes.cy)
    const r = svgNumber(node.attributes.r)
    if (r <= 0) return null
    return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`
  }
  if (node.tag === 'ellipse') {
    const cx = svgNumber(node.attributes.cx)
    const cy = svgNumber(node.attributes.cy)
    const rx = svgNumber(node.attributes.rx)
    const ry = svgNumber(node.attributes.ry)
    if (rx <= 0 || ry <= 0) return null
    return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0`
  }
  if (node.tag === 'rect') {
    const x = svgNumber(node.attributes.x)
    const y = svgNumber(node.attributes.y)
    const width = svgNumber(node.attributes.width)
    const height = svgNumber(node.attributes.height)
    const rx = Math.min(svgNumber(node.attributes.rx), width / 2)
    const ry = Math.min(
      svgNumber(node.attributes.ry, svgNumber(node.attributes.rx)),
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
  if (node.tag === 'line') {
    const x1 = svgNumber(node.attributes.x1)
    const y1 = svgNumber(node.attributes.y1)
    const x2 = svgNumber(node.attributes.x2)
    const y2 = svgNumber(node.attributes.y2)
    return `M ${x1} ${y1} L ${x2} ${y2}`
  }
  if (node.tag === 'polyline' || node.tag === 'polygon') {
    const points = (node.attributes.points || '')
      .trim()
      .split(/[\s,]+/)
      .map(Number.parseFloat)
      .filter(Number.isFinite)
    if (points.length < 4) return null
    const pairs: string[] = []
    for (let index = 0; index + 1 < points.length; index += 2) {
      pairs.push(`${points[index]} ${points[index + 1]}`)
    }
    const prefix = pairs.map((pair, index) => (index === 0 ? `M ${pair}` : `L ${pair}`))
    if (node.tag === 'polygon') prefix.push('Z')
    return prefix.join(' ')
  }
  return null
}

function vectorNode(
  snapshot: HtmlCanvasSnapshot,
  parentId: NodeId,
  order: number,
  parentOrigin: HtmlCanvasOrigin,
  parentMode: 'absolute' | 'flex' | 'grid',
): VectorNode | null {
  if (snapshot.tag !== 'svg') return null
  const paths: VectorNode['paths'] = []
  const visit = (
    node: HtmlCanvasSnapshot,
    inherited: {
      fill?: string
      stroke?: string
      strokeWidth?: number
    },
  ) => {
    const fill = safeImportedColor(
      node.attributes.fill || node.style.fill || inherited.fill,
    )
    const strokeColor = safeImportedColor(
      node.attributes.stroke || node.style.stroke || inherited.stroke,
    )
    const ownStrokeWidth = Number.parseFloat(
      node.attributes['stroke-width'] ?? node.style.strokeWidth ?? '',
    )
    const strokeWidth = Number.isFinite(ownStrokeWidth)
      ? ownStrokeWidth
      : inherited.strokeWidth
    const d = shapePathData(node)
    if (d) {
      paths.push({
        d,
        ...(fill && fill !== 'none' ? { fill } : {}),
        ...(strokeColor && strokeColor !== 'none' ? { stroke: strokeColor } : {}),
        ...(strokeWidth !== undefined ? { strokeWidth } : {}),
      })
    }
    node.children.forEach((child) =>
      visit(child, {
        fill: fill ?? inherited.fill,
        stroke: strokeColor ?? inherited.stroke,
        strokeWidth,
      }),
    )
  }
  visit(snapshot, {})
  if (paths.length === 0) return null
  const frame = createFrameNode(
    snapshot.attributes['aria-label'] || 'Vector',
    {
      id: canvasId('vector'),
      parentId,
      order,
      layout: nodeLayout(snapshot, parentOrigin, parentMode),
      style: frameStyle(snapshot.style),
    },
  )
  const { semanticTag: _semanticTag, ...base } = frame
  return {
    ...base,
    type: 'vector',
    viewBox:
      snapshot.attributes.viewBox ||
      `0 0 ${positiveDimension(snapshot.rect.width)} ${positiveDimension(snapshot.rect.height)}`,
    paths,
    metadata: { importedHtmlTag: 'svg' },
  }
}

function imageNode(
  snapshot: HtmlCanvasSnapshot,
  parentId: NodeId,
  order: number,
  parentOrigin: HtmlCanvasOrigin,
  parentMode: 'absolute' | 'flex' | 'grid',
): ImageNode | null {
  if (snapshot.tag !== 'img') return null
  const src = safeUrl(snapshot.attributes.src)
  if (!src) return null
  const frame = createFrameNode(
    snapshot.attributes.alt || snapshot.attributes['aria-label'] || 'Image',
    {
      id: canvasId('image'),
      parentId,
      order,
      layout: nodeLayout(snapshot, parentOrigin, parentMode),
      style: frameStyle(snapshot.style),
    },
  )
  const { semanticTag: _semanticTag, ...base } = frame
  return {
    ...base,
    type: 'image',
    src,
    alt: (snapshot.attributes.alt || '').slice(0, 1_000),
    fit:
      snapshot.style.objectFit === 'contain' ||
      snapshot.style.objectFit === 'fill'
        ? snapshot.style.objectFit
        : 'cover',
    metadata: { importedHtmlTag: 'img' },
  }
}

/**
 * Whether the element paints a box of its own. A label that does gets a frame
 * and a text child, because a Canvas text node spends its fill on the glyphs —
 * flattening a pill into one text node throws its background away.
 */
function hasVisibleBox(style: Record<string, string>) {
  return (
    backgroundPaints(style).length > 0 ||
    !!stroke(style) ||
    shadows(style.boxShadow).length > 0 ||
    !!backgroundImageUrl(style.backgroundImage) ||
    ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].some(
      (side) => numberStyle(style, side) > 0,
    )
  )
}

function textNode(
  snapshot: HtmlCanvasSnapshot,
  patch: {
    id: NodeId
    parentId: NodeId
    order: number
    layout: CanvasLayout
  },
): TextNode {
  const style = textStyle(snapshot.style)
  const typography = style.typography!
  // A line that was measured as one line has to stay one line. The editor
  // rarely has the source page's webfont, and a substituted one that wraps
  // pushes every box after it out of place.
  const lineHeight = typography.lineHeight * typography.size
  const singleLine =
    lineHeight > 0 &&
    snapshot.rect.height > 0 &&
    snapshot.rect.height < lineHeight * 1.5
  return createTextNode(cleanText(snapshot.text ?? ''), {
    ...patch,
    style: singleLine
      ? { ...style, typography: { ...typography, wrap: false } }
      : style,
    metadata: { importedHtmlTag: snapshot.tag },
  })
}

function convertSnapshot(
  snapshot: HtmlCanvasSnapshot,
  parentId: NodeId,
  order: number,
  parentOrigin: HtmlCanvasOrigin,
  parentMode: 'absolute' | 'flex' | 'grid',
  nodes: Record<NodeId, CanvasNode>,
  warnings: string[],
) {
  if (snapshot.rasterDataUrl && safeUrl(snapshot.rasterDataUrl)) {
    const frame = createFrameNode(
      snapshot.attributes['aria-label'] ||
        snapshot.attributes.title ||
        snapshot.tag ||
        'Raster',
      {
        id: canvasId('image'),
        parentId,
        order,
        layout: nodeLayout(snapshot, parentOrigin, parentMode),
        style: frameStyle(snapshot.style),
      },
    )
    const { semanticTag: _semanticTag, ...base } = frame
    nodes[frame.id] = {
      ...base,
      type: 'image',
      src: snapshot.rasterDataUrl,
      alt: (snapshot.attributes.alt || '').slice(0, 1_000),
      fit: 'fill',
      metadata: {
        importedHtmlTag: snapshot.tag,
        importedAs: 'raster',
      },
    }
    return frame.id
  }

  const vector = vectorNode(
    snapshot,
    parentId,
    order,
    parentOrigin,
    parentMode,
  )
  if (vector) {
    nodes[vector.id] = vector
    return vector.id
  }

  if (snapshot.tag === 'svg') {
    warnings.push('An SVG without editable paths was simplified to a frame.')
  }

  const image = imageNode(
    snapshot,
    parentId,
    order,
    parentOrigin,
    parentMode,
  )
  if (image) {
    nodes[image.id] = image
    return image.id
  }
  if (snapshot.tag === 'img') {
    warnings.push('An image with an unsupported or relative URL was skipped.')
    return null
  }

  const asText =
    snapshot.tag === '#text' ||
    (textTags.has(snapshot.tag) &&
      !!snapshot.text &&
      snapshot.children.length === 0)
  if (asText && !(snapshot.tag !== '#text' && hasVisibleBox(snapshot.style))) {
    const value = cleanText(snapshot.text ?? '')
    if (!value) return null
    const id = canvasId('text')
    nodes[id] = textNode(snapshot, {
      id,
      parentId,
      order,
      layout: {
        ...nodeLayout(snapshot, parentOrigin, parentMode),
        mode: 'absolute',
      },
    })
    return id
  }

  const id = canvasId('frame')
  const ownMode = childArrangement(snapshot)
  const tag = semanticTags.has(snapshot.tag as SemanticTag)
    ? (snapshot.tag as SemanticTag)
    : 'div'
  const aspect = (() => {
    const raw = snapshot.style.aspectRatio?.trim()
    if (!raw || raw === 'auto') return undefined
    const parts = raw.split('/').map((part) => Number.parseFloat(part.trim()))
    if (
      parts.length === 2 &&
      parts.every((part) => Number.isFinite(part)) &&
      parts[1]! > 0
    ) {
      return parts[0]! / parts[1]!
    }
    const single = Number.parseFloat(raw)
    return Number.isFinite(single) && single > 0 ? single : undefined
  })()
  const frame: FrameNode = createFrameNode(
    snapshot.attributes['aria-label'] ||
      snapshot.attributes.title ||
      snapshot.tag ||
      'Frame',
    {
      id,
      parentId,
      order,
      semanticTag: tag,
      rotation: rotation(snapshot.style.transform),
      layout: {
        ...nodeLayout(snapshot, parentOrigin, parentMode, ownMode),
        ...(aspect !== undefined ? { aspectRatio: aspect } : {}),
      },
      style: frameStyle(snapshot.style),
      interactions: interactions(snapshot),
      metadata: { importedHtmlTag: snapshot.tag },
    },
  )
  nodes[id] = frame
  const origin = childOrigin(snapshot, frame.layout, frame.style)
  const backgroundSrc = backgroundImageUrl(snapshot.style.backgroundImage)
  if (backgroundSrc && Object.keys(nodes).length < MAX_HTML_IMPORT_NODES) {
    const width = positiveDimension(snapshot.rect.width)
    const height = positiveDimension(snapshot.rect.height)
    const offset = backgroundImageOffset(snapshot.style, width, height)
    const backgroundFrame = createFrameNode(`${frame.name} background`, {
      id: canvasId('image'),
      parentId: id,
      order: 0,
      layout: defaultLayout(width, height, {
        position: 'absolute',
        x: offset.x,
        y: offset.y,
      }),
      style: defaultStyle(),
    })
    const { semanticTag: _semanticTag, ...base } = backgroundFrame
    nodes[backgroundFrame.id] = {
      ...base,
      type: 'image',
      src: backgroundSrc,
      alt: '',
      fit: backgroundImageFit(snapshot.style),
      metadata: {
        importedHtmlTag: snapshot.tag,
        importedCssProperty: 'background-image',
      },
    }
  }
  // A styled label carries its own text, and the frame above holds the box it
  // is painted in.
  if (
    snapshot.text &&
    cleanText(snapshot.text) &&
    Object.keys(nodes).length < MAX_HTML_IMPORT_NODES
  ) {
    const labelId = canvasId('text')
    nodes[labelId] = textNode(snapshot, {
      id: labelId,
      parentId: id,
      order: DEFAULT_ORDER_STEP,
      layout: defaultLayout(
        positiveDimension(snapshot.rect.width),
        positiveDimension(snapshot.rect.height),
        {
          position: 'flow',
          x: 0,
          y: 0,
          width: ownMode === 'absolute' ? { unit: 'fill' } : { unit: 'hug' },
          height: { unit: 'hug' },
        },
      ),
    })
  }
  snapshot.children.forEach((child, index) => {
    if (Object.keys(nodes).length >= MAX_HTML_IMPORT_NODES) {
      throw new Error(
        `HTML import exceeds the ${MAX_HTML_IMPORT_NODES.toLocaleString()} node limit`,
      )
    }
    convertSnapshot(
      child,
      id,
      (index + 1) * DEFAULT_ORDER_STEP,
      origin,
      ownMode,
      nodes,
      warnings,
    )
  })
  return id
}

function sanitizeImportedPaint(
  paint: CanvasStyle['fills'][number],
): CanvasStyle['fills'][number] | null {
  if (paint.type === 'solid') {
    if (typeof paint.color !== 'string') return null
    const color = safeImportedColor(paint.color)
    return color ? { type: 'solid', color } : null
  }
  const stops = paint.stops
    .map((stop) => {
      const color =
        typeof stop.color === 'string'
          ? safeImportedColor(stop.color)
          : undefined
      return color
        ? { offset: stop.offset, color }
        : null
    })
    .filter((stop): stop is { offset: number; color: string } => stop !== null)
  if (stops.length < 2) return null
  if (paint.type === 'linear-gradient') {
    return { type: 'linear-gradient', angle: paint.angle, stops }
  }
  const size =
    paint.size &&
    paint.size.length > 0 &&
    paint.size.length <= 100 &&
    !/[{};<>\\\u0000-\u001f\u007f]/.test(paint.size)
      ? paint.size
      : undefined
  return {
    type: 'radial-gradient',
    cx: paint.cx,
    cy: paint.cy,
    ...(size ? { size } : {}),
    stops,
  }
}

/**
 * Last-chance cleanup before assertDocument so one unresolved live color
 * (light-dark, -webkit-*, etc.) cannot abort an otherwise good Paper paste.
 */
function sanitizeImportedDocument(document: CanvasDocument) {
  for (const node of Object.values(document.nodes)) {
    const fills = node.style.fills
      .map(sanitizeImportedPaint)
      .filter((paint): paint is NonNullable<typeof paint> => paint !== null)
    const shadows = node.style.shadows.filter((shadow) => {
      if (typeof shadow.color !== 'string') return false
      const color = safeImportedColor(shadow.color)
      if (!color) return false
      shadow.color = color
      return true
    })
    let stroke = node.style.stroke
    if (stroke) {
      const color =
        typeof stroke.color === 'string'
          ? safeImportedColor(stroke.color)
          : undefined
      stroke = color ? { ...stroke, color } : undefined
    }
    node.style.fills = fills
    node.style.shadows = shadows
    if (stroke) node.style.stroke = stroke
    else delete node.style.stroke
    if (node.style.typography) {
      node.style.typography = {
        ...node.style.typography,
        family: sanitizeFontFamily(node.style.typography.family),
      }
    }
    if (node.type === 'vector') {
      node.paths = node.paths.map((path) => {
        const next = { ...path }
        if (typeof path.fill === 'string') {
          const fill = safeImportedColor(path.fill)
          if (fill) next.fill = fill
          else delete next.fill
        }
        if (typeof path.stroke === 'string') {
          const strokeColor = safeImportedColor(path.stroke)
          if (strokeColor) next.stroke = strokeColor
          else delete next.stroke
        }
        return next
      })
    }
  }
}

export function convertHtmlSnapshotToCanvas(
  input: HtmlCanvasImportInput,
): HtmlCanvasImportResult {
  const width = Math.min(10_000, Math.max(1, finite(input.width, 1)))
  const height = Math.min(20_000, Math.max(1, finite(input.height, 1)))
  const document = createCanvasDocument(
    input.name.trim().slice(0, 200) || 'Imported page',
    input.id.trim().slice(0, 200) || canvasId('document'),
  )
  const page = createPageNode(input.name.trim().slice(0, 200) || 'Imported page', {
    id: canvasId('page'),
    order: DEFAULT_ORDER_STEP,
    layout: defaultLayout(width, height, { x: 120, y: 80 }),
    viewport: { width, minHeight: height },
    metadata: { importedFrom: 'html' },
  })
  document.nodes[page.id] = page
  const warnings: string[] = []
  const sourceChildren =
    input.root.tag === 'body' || input.root.tag === 'html'
      ? input.root.children
      : [input.root]
  const children = sourceChildren.flatMap((child) =>
    child.tag === 'x-paper-html' ? child.children : [child],
  )
  children.forEach((child, index) => {
    if (Object.keys(document.nodes).length >= MAX_HTML_IMPORT_NODES) {
      throw new Error(
        `HTML import exceeds the ${MAX_HTML_IMPORT_NODES.toLocaleString()} node limit`,
      )
    }
    convertSnapshot(
      child,
      page.id,
      (index + 1) * DEFAULT_ORDER_STEP,
      // The Page places its children freely, so a root keeps the position it
      // was captured at rather than being arranged by the body's own display.
      { x: input.root.rect.x, y: input.root.rect.y },
      'absolute',
      document.nodes,
      warnings,
    )
  })

  sanitizeImportedDocument(document)
  assertDocument(document)
  return {
    document,
    pageId: page.id,
    warnings: [...new Set(warnings)].slice(0, 100),
  }
}
