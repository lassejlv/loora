import {
  type CanvasDocument,
  type CanvasInteraction,
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
  return (
    !color ||
    color === 'transparent' ||
    color === 'rgba(0, 0, 0, 0)' ||
    color === 'rgba(0,0,0,0)'
  )
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
  const widths = [
    numberStyle(style, 'borderTopWidth'),
    numberStyle(style, 'borderRightWidth'),
    numberStyle(style, 'borderBottomWidth'),
    numberStyle(style, 'borderLeftWidth'),
  ]
  const width = Math.max(...widths)
  const color = style.borderTopColor
  if (width <= 0 || isTransparent(color)) return undefined
  const borderStyle = style.borderTopStyle
  return {
    width,
    color,
    style:
      borderStyle === 'dashed' || borderStyle === 'dotted'
        ? borderStyle
        : 'solid',
  }
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

function shadows(value: string | undefined): CanvasShadow[] {
  if (!value || value === 'none') return []
  const result: CanvasShadow[] = []
  for (const part of splitCssList(value).slice(0, 16)) {
    const color =
      part.match(
        /(rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|#[0-9a-f]{3,8}|[a-z]+)$/i,
      )?.[1] ?? 'rgba(0, 0, 0, 0.2)'
    const lengths = part
      .replace(color, '')
      .replace(/\binset\b/i, '')
      .match(/-?\d*\.?\d+(?:px)?/g)
      ?.map((item) => Number.parseFloat(item)) ?? []
    if (lengths.length < 2 || lengths.some((item) => !Number.isFinite(item))) {
      continue
    }
    result.push({
      x: lengths[0]!,
      y: lengths[1]!,
      blur: Math.max(0, lengths[2] ?? 0),
      spread: lengths[3] ?? 0,
      color,
      ...(part.includes('inset') ? { inset: true } : {}),
    })
  }
  return result
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
  const background = style.backgroundColor
  return defaultStyle({
    fills: isTransparent(background)
      ? []
      : [{ type: 'solid' as const, color: background }],
    stroke: stroke(style),
    radius: radius(style),
    shadows: shadows(style.boxShadow),
    opacity: opacity(style),
    overflow: overflow(style),
    ...(style.mixBlendMode && style.mixBlendMode !== 'normal'
      ? { blendMode: style.mixBlendMode }
      : {}),
  })
}

function textStyle(style: Record<string, string>) {
  const fontSize = Math.max(1, numberStyle(style, 'fontSize', 16))
  return defaultStyle({
    fills: isTransparent(style.color)
      ? []
      : [{ type: 'solid' as const, color: style.color || '#000000' }],
    opacity: opacity(style),
    typography: {
      family: (style.fontFamily || 'Archivo').slice(0, 200),
      size: fontSize,
      weight: textWeight(style.fontWeight),
      lineHeight: textLineHeight(style, fontSize),
      letterSpacing: numberStyle(style, 'letterSpacing'),
      align: textAlign(style.textAlign),
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

function nodeLayout(
  snapshot: HtmlCanvasSnapshot,
  parentRect: HtmlCanvasRect,
  parentMode: 'absolute' | 'flex' | 'grid',
) {
  const ownMode = mode(snapshot.style)
  const isFlow =
    parentMode !== 'absolute' &&
    snapshot.style.position !== 'absolute' &&
    snapshot.style.position !== 'fixed'
  return defaultLayout(
    positiveDimension(snapshot.rect.width),
    positiveDimension(snapshot.rect.height),
    {
      position: isFlow ? 'flow' : 'absolute',
      x: isFlow ? 0 : finite(snapshot.rect.x - parentRect.x),
      y: isFlow ? 0 : finite(snapshot.rect.y - parentRect.y),
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

function vectorNode(
  snapshot: HtmlCanvasSnapshot,
  parentId: NodeId,
  order: number,
  parentRect: HtmlCanvasRect,
  parentMode: 'absolute' | 'flex' | 'grid',
): VectorNode | null {
  if (snapshot.tag !== 'svg') return null
  const paths: VectorNode['paths'] = []
  const visit = (node: HtmlCanvasSnapshot) => {
    if (node.tag === 'path' && node.attributes.d) {
      paths.push({
        d: node.attributes.d,
        ...(node.attributes.fill && node.attributes.fill !== 'none'
          ? { fill: node.attributes.fill }
          : {}),
        ...(node.attributes.stroke && node.attributes.stroke !== 'none'
          ? { stroke: node.attributes.stroke }
          : {}),
        ...(Number.isFinite(Number.parseFloat(node.attributes['stroke-width'] ?? ''))
          ? { strokeWidth: Number.parseFloat(node.attributes['stroke-width']!) }
          : {}),
      })
    }
    node.children.forEach(visit)
  }
  visit(snapshot)
  if (paths.length === 0) return null
  const frame = createFrameNode(
    snapshot.attributes['aria-label'] || 'Vector',
    {
      id: canvasId('vector'),
      parentId,
      order,
      layout: nodeLayout(snapshot, parentRect, parentMode),
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
  parentRect: HtmlCanvasRect,
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
      layout: nodeLayout(snapshot, parentRect, parentMode),
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

function convertSnapshot(
  snapshot: HtmlCanvasSnapshot,
  parentId: NodeId,
  order: number,
  parentRect: HtmlCanvasRect,
  parentMode: 'absolute' | 'flex' | 'grid',
  nodes: Record<NodeId, CanvasNode>,
  warnings: string[],
) {
  const vector = vectorNode(
    snapshot,
    parentId,
    order,
    parentRect,
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
    parentRect,
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
  if (asText) {
    const value = cleanText(snapshot.text ?? '')
    if (!value) return null
    const id = canvasId('text')
    const text: TextNode = createTextNode(value, {
      id,
      parentId,
      order,
      layout: {
        ...nodeLayout(snapshot, parentRect, parentMode),
        mode: 'absolute',
        height: { unit: 'hug' },
      },
      style: textStyle(snapshot.style),
      metadata: { importedHtmlTag: snapshot.tag },
    })
    nodes[id] = text
    return id
  }

  const id = canvasId('frame')
  const ownMode = mode(snapshot.style)
  const tag = semanticTags.has(snapshot.tag as SemanticTag)
    ? (snapshot.tag as SemanticTag)
    : 'div'
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
      layout: nodeLayout(snapshot, parentRect, parentMode),
      style: frameStyle(snapshot.style),
      interactions: interactions(snapshot),
      metadata: { importedHtmlTag: snapshot.tag },
    },
  )
  nodes[id] = frame
  const backgroundSrc = backgroundImageUrl(snapshot.style.backgroundImage)
  if (backgroundSrc && Object.keys(nodes).length < MAX_HTML_IMPORT_NODES) {
    const backgroundFrame = createFrameNode(`${frame.name} background`, {
      id: canvasId('image'),
      parentId: id,
      order: 0,
      layout: defaultLayout(
        positiveDimension(snapshot.rect.width),
        positiveDimension(snapshot.rect.height),
        { position: 'absolute', x: 0, y: 0 },
      ),
      style: defaultStyle(),
    })
    const { semanticTag: _semanticTag, ...base } = backgroundFrame
    nodes[backgroundFrame.id] = {
      ...base,
      type: 'image',
      src: backgroundSrc,
      alt: '',
      fit: 'cover',
      metadata: { importedHtmlTag: snapshot.tag, importedCssProperty: 'background-image' },
    }
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
      snapshot.rect,
      ownMode,
      nodes,
      warnings,
    )
  })
  return id
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
  const rootMode = mode(input.root.style)
  const children =
    input.root.tag === 'body' || input.root.tag === 'html'
      ? input.root.children
      : [input.root]
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
      input.root.rect,
      rootMode === 'absolute' ? 'absolute' : rootMode,
      document.nodes,
      warnings,
    )
  })

  assertDocument(document)
  return {
    document,
    pageId: page.id,
    warnings: [...new Set(warnings)].slice(0, 100),
  }
}
