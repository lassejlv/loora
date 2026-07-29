import { Buffer } from 'node:buffer'
import { and, eq } from 'drizzle-orm'
import { db } from '@loora/db'
import { asset, design, designDraft, designVersion } from '@loora/db/schema'
import {
  CANVAS_SCHEMA_VERSION,
  DEFAULT_ORDER_STEP,
  assertDocument,
  createCanvasDocument,
  createFrameNode,
  createPageNode,
  createTextNode,
  defaultLayout,
  defaultStyle,
  orderedChildren,
  type CanvasColor,
  type CanvasDocument,
  type CanvasLayout,
  type CanvasNode,
  type CanvasPaint,
  type CanvasShadow,
  type CanvasStyle,
  type ComponentNode,
  type ImageNode,
  type NodeId,
  type NodePatch,
  type PageNode,
  type SemanticTag,
} from '@loora/canvas/model'
import { diffDocuments } from '@loora/canvas/merge'
import {
  FigmaIntegrationError,
  getFigmaAccessToken,
} from '@loora/auth/figma'
import { assetKey, s3 } from './storage'

const MAX_ROOTS = 100
const MAX_NODES = 10_000
const MAX_ASSET_BYTES = 5 * 1024 * 1024
const MAX_TOTAL_ASSET_BYTES = 25 * 1024 * 1024
const PAGE_GAP = 160
const FALLBACK_BATCH_SIZE = 50
const TRANSPARENT_IMAGE =
  'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='

const AVAILABLE_FONTS = new Set([
  'arial',
  'archivo',
  'helvetica',
  'inter',
  'lora',
  'playfair display',
  'space grotesk',
  'spline sans mono',
  'times new roman',
])

export interface FigmaFileReference {
  key: string
  nodeId: string | null
}

export interface FigmaImportTarget {
  id: string
  name: string
  draftId?: string | null
  revision: number
}

interface FigmaBounds {
  x: number
  y: number
  width: number
  height: number
}

interface FigmaColor {
  r: number
  g: number
  b: number
  a?: number
}

interface FigmaGradientStop {
  position: number
  color: FigmaColor
}

interface FigmaPaint {
  type: string
  visible?: boolean
  opacity?: number
  color?: FigmaColor
  gradientStops?: FigmaGradientStop[]
  gradientHandlePositions?: { x: number; y: number }[]
  imageRef?: string
}

interface FigmaEffect {
  type: string
  visible?: boolean
  radius?: number
  spread?: number
  offset?: { x: number; y: number }
  color?: FigmaColor
}

interface FigmaTextStyle {
  fontFamily?: string
  fontWeight?: number
  fontSize?: number
  lineHeightPx?: number
  lineHeightPercentFontSize?: number
  letterSpacing?: number
  textAlignHorizontal?: string
  textCase?: string
  textDecoration?: string
}

interface FigmaPath {
  path: string
  windingRule?: string
}

export interface FigmaNode {
  id: string
  name: string
  type: string
  visible?: boolean
  opacity?: number
  rotation?: number
  blendMode?: string
  isMask?: boolean
  clipsContent?: boolean
  absoluteBoundingBox?: FigmaBounds
  children?: FigmaNode[]
  fills?: FigmaPaint[] | string
  strokes?: FigmaPaint[] | string
  strokeWeight?: number
  cornerRadius?: number
  rectangleCornerRadii?: number[]
  effects?: FigmaEffect[]
  characters?: string
  style?: FigmaTextStyle
  characterStyleOverrides?: number[]
  layoutMode?: 'HORIZONTAL' | 'VERTICAL' | 'NONE'
  primaryAxisAlignItems?: string
  counterAxisAlignItems?: string
  itemSpacing?: number
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
  layoutWrap?: string
  layoutSizingHorizontal?: string
  layoutSizingVertical?: string
  componentId?: string
  componentProperties?: Record<string, { type: string; value: string | boolean }>
  fillGeometry?: FigmaPath[]
}

interface FigmaFilePayload {
  name: string
  editorType?: string
  document: FigmaNode
  err?: string
}

interface ImportRoot {
  pageName: string
  node: FigmaNode
}

interface RasterFallback {
  figmaNodeId: string
  canvasNodeId: string
}

interface RenderedAsset {
  id: string
  nodeId: string
  name: string
  mediaType: string
  bytes: Uint8Array
}

export interface FigmaImportSummary {
  pages: number
  frames: number
  fallbacks: number
  missingFonts: string[]
}

export interface FigmaConversion {
  document: CanvasDocument
  fallbacks: RasterFallback[]
  fonts: string[]
  pages: number
  frames: number
}

function fail(
  message: string,
  code: ConstructorParameters<typeof FigmaIntegrationError>[1],
): never {
  throw new FigmaIntegrationError(message, code)
}

export function parseFigmaFileUrl(value: string): FigmaFileReference {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return fail('Paste a valid Figma file or frame link.', 'INVALID_FILE')
  }
  if (
    url.protocol !== 'https:' ||
    !['figma.com', 'www.figma.com'].includes(url.hostname)
  ) {
    return fail('Paste a link from figma.com.', 'INVALID_FILE')
  }
  const parts = url.pathname.split('/').filter(Boolean)
  if (!['design', 'file', 'proto'].includes(parts[0] ?? '') || !parts[1]) {
    return fail('This is not a Figma Design file link.', 'INVALID_FILE')
  }
  const key = parts[1]
  if (!/^[a-zA-Z0-9_-]{6,200}$/.test(key)) {
    return fail('The Figma file key is invalid.', 'INVALID_FILE')
  }
  const rawNodeId = url.searchParams.get('node-id')
  const nodeId = rawNodeId
    ? rawNodeId.includes(':')
      ? rawNodeId
      : rawNodeId.replaceAll('-', ':')
    : null
  if (nodeId && !/^\d+(?::\d+)+$/.test(nodeId)) {
    return fail('The Figma frame identifier is invalid.', 'INVALID_FILE')
  }
  return { key, nodeId }
}

function finite(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function alpha(value: unknown, fallback = 1) {
  return Math.max(0, Math.min(1, finite(value, fallback)))
}

function figmaColor(value: FigmaColor | undefined, opacity = 1): string {
  if (!value) return 'rgba(0, 0, 0, 0)'
  return `rgba(${Math.round(alpha(value.r) * 255)}, ${Math.round(alpha(value.g) * 255)}, ${Math.round(alpha(value.b) * 255)}, ${alpha((value.a ?? 1) * opacity)})`
}

function visiblePaints(value: FigmaNode['fills']) {
  if (!Array.isArray(value)) return value == null ? [] : null
  return value.filter((paint) => paint.visible !== false && alpha(paint.opacity) > 0)
}

function paint(value: FigmaPaint): CanvasPaint | null {
  if (value.type === 'SOLID') {
    return {
      type: 'solid',
      color: figmaColor(value.color, value.opacity),
    }
  }
  if (value.type !== 'GRADIENT_LINEAR' || !value.gradientStops?.length) {
    return null
  }
  const [start, end] = value.gradientHandlePositions ?? []
  const angle =
    start && end
      ? Math.atan2(end.y - start.y, end.x - start.x) * (180 / Math.PI) + 90
      : 180
  return {
    type: 'linear-gradient',
    angle,
    stops: value.gradientStops.map((stop) => ({
      offset: stop.position,
      color: figmaColor(stop.color, value.opacity),
    })),
  }
}

function shadows(node: FigmaNode): CanvasShadow[] | null {
  const result: CanvasShadow[] = []
  for (const effect of node.effects ?? []) {
    if (effect.visible === false) continue
    if (effect.type !== 'DROP_SHADOW' && effect.type !== 'INNER_SHADOW') {
      return null
    }
    result.push({
      x: finite(effect.offset?.x),
      y: finite(effect.offset?.y),
      blur: Math.max(0, finite(effect.radius)),
      spread: finite(effect.spread),
      color: figmaColor(effect.color),
      inset: effect.type === 'INNER_SHADOW',
    })
  }
  return result
}

function styleFor(node: FigmaNode, fonts: Set<string>): CanvasStyle | null {
  const fills = visiblePaints(node.fills)
  const strokes = visiblePaints(node.strokes)
  const nodeShadows = shadows(node)
  if (fills == null || strokes == null || nodeShadows == null) return null
  const mappedFills = fills.map(paint)
  if (mappedFills.some((entry) => !entry)) return null
  const strokePaint = strokes[0]
  if (
    strokes.length > 1 ||
    (strokePaint && strokePaint.type !== 'SOLID')
  ) {
    return null
  }
  const text = node.style
  if (text?.fontFamily) fonts.add(text.fontFamily)
  const radius =
    node.rectangleCornerRadii?.length === 4
      ? (node.rectangleCornerRadii as [number, number, number, number])
      : Math.max(0, finite(node.cornerRadius))
  return defaultStyle({
    fills: mappedFills as CanvasPaint[],
    stroke: strokePaint
      ? {
          color: figmaColor(strokePaint.color, strokePaint.opacity),
          width: Math.max(0, finite(node.strokeWeight, 1)),
        }
      : undefined,
    radius,
    shadows: nodeShadows,
    opacity: alpha(node.opacity),
    overflow: node.clipsContent ? 'hidden' : 'visible',
    blendMode:
      node.blendMode && !['NORMAL', 'PASS_THROUGH'].includes(node.blendMode)
        ? node.blendMode.toLowerCase().replaceAll('_', '-')
        : undefined,
    typography:
      node.type === 'TEXT'
        ? {
            family: text?.fontFamily || 'Inter',
            size: Math.max(1, finite(text?.fontSize, 16)),
            weight: Math.max(1, finite(text?.fontWeight, 400)),
            lineHeight:
              text?.lineHeightPx && text.fontSize
                ? text.lineHeightPx / text.fontSize
                : Math.max(
                    0.1,
                    finite(text?.lineHeightPercentFontSize, 120) / 100,
                  ),
            letterSpacing: finite(text?.letterSpacing),
            align:
              text?.textAlignHorizontal?.toLowerCase() === 'center'
                ? 'center'
                : text?.textAlignHorizontal?.toLowerCase() === 'right'
                  ? 'right'
                  : text?.textAlignHorizontal?.toLowerCase() === 'justified'
                    ? 'justify'
                    : 'left',
            decoration:
              text?.textDecoration === 'UNDERLINE'
                ? 'underline'
                : text?.textDecoration === 'STRIKETHROUGH'
                  ? 'line-through'
                  : 'none',
            transform:
              text?.textCase === 'UPPER'
                ? 'uppercase'
                : text?.textCase === 'LOWER'
                  ? 'lowercase'
                  : text?.textCase === 'TITLE'
                    ? 'capitalize'
                    : 'none',
          }
        : undefined,
  })
}

function layoutFor(
  node: FigmaNode,
  parent: FigmaNode | null,
  flow: boolean,
): CanvasLayout | null {
  const bounds = node.absoluteBoundingBox
  if (!bounds) return null
  const parentBounds = parent?.absoluteBoundingBox
  const auto = node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL'
  return defaultLayout(
    Math.max(1, bounds.width),
    Math.max(1, bounds.height),
    {
      position: flow ? 'flow' : 'absolute',
      x: flow || !parentBounds ? 0 : bounds.x - parentBounds.x,
      y: flow || !parentBounds ? 0 : bounds.y - parentBounds.y,
      width:
        node.layoutSizingHorizontal === 'FILL'
          ? { unit: 'fill' }
          : node.layoutSizingHorizontal === 'HUG'
            ? { unit: 'hug' }
            : { unit: 'px', value: Math.max(1, bounds.width) },
      height:
        node.layoutSizingVertical === 'FILL'
          ? { unit: 'fill' }
          : node.layoutSizingVertical === 'HUG'
            ? { unit: 'hug' }
            : { unit: 'px', value: Math.max(1, bounds.height) },
      mode: auto ? 'flex' : 'absolute',
      direction: node.layoutMode === 'HORIZONTAL' ? 'row' : 'column',
      wrap: node.layoutWrap === 'WRAP',
      gap: Math.max(0, finite(node.itemSpacing)),
      padding: auto
        ? {
            top: Math.max(0, finite(node.paddingTop)),
            right: Math.max(0, finite(node.paddingRight)),
            bottom: Math.max(0, finite(node.paddingBottom)),
            left: Math.max(0, finite(node.paddingLeft)),
          }
        : undefined,
      align:
        node.counterAxisAlignItems === 'CENTER'
          ? 'center'
          : node.counterAxisAlignItems === 'MAX'
            ? 'end'
            : node.counterAxisAlignItems === 'BASELINE'
              ? 'start'
              : 'start',
      justify:
        node.primaryAxisAlignItems === 'CENTER'
          ? 'center'
          : node.primaryAxisAlignItems === 'MAX'
            ? 'end'
            : node.primaryAxisAlignItems === 'SPACE_BETWEEN'
              ? 'space-between'
              : 'start',
    },
  )
}

function countNodes(node: FigmaNode): number {
  return 1 + (node.children ?? []).reduce((sum, child) => sum + countNodes(child), 0)
}

function findNode(node: FigmaNode, id: string): FigmaNode | null {
  if (node.id === id) return node
  for (const child of node.children ?? []) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

function pageForNode(document: FigmaNode, id: string): string {
  for (const page of document.children ?? []) {
    if (findNode(page, id)) return page.name
  }
  return 'Page'
}

function importRoots(payload: FigmaFilePayload, nodeId: string | null): ImportRoot[] {
  if (nodeId) {
    const node = findNode(payload.document, nodeId)
    if (!node?.absoluteBoundingBox || node.visible === false) {
      return fail(
        'That Figma frame is missing, hidden, or not renderable.',
        'INVALID_FILE',
      )
    }
    return [{ pageName: pageForNode(payload.document, nodeId), node }]
  }
  const roots = (payload.document.children ?? []).flatMap((page) =>
    (page.children ?? [])
      .filter((node) => node.visible !== false && node.absoluteBoundingBox)
      .map((node) => ({ pageName: page.name, node })),
  )
  if (roots.length === 0) {
    return fail('This Figma file has no visible frames to import.', 'INVALID_FILE')
  }
  if (roots.length > MAX_ROOTS) {
    return fail(
      `This file has more than ${MAX_ROOTS} top-level layers. Paste a link to a specific frame instead.`,
      'TOO_LARGE',
    )
  }
  return roots
}

function semanticTag(node: FigmaNode): SemanticTag {
  const name = node.name.toLowerCase()
  if (name.includes('header')) return 'header'
  if (name.includes('footer')) return 'footer'
  if (name.includes('navigation') || name === 'nav') return 'nav'
  if (name.includes('button')) return 'button'
  if (name.includes('form')) return 'form'
  if (name.includes('section') || node.type === 'SECTION') return 'section'
  return 'div'
}

function safeIdPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80)
}

function createIdAllocator(existing: CanvasDocument) {
  const used = new Set(Object.keys(existing.nodes))
  return (prefix: string, figmaId: string) => {
    const base = `${prefix}_${safeIdPart(figmaId)}`
    let id = base
    let suffix = 2
    while (used.has(id)) {
      id = `${base}_${suffix}`
      suffix += 1
    }
    used.add(id)
    return id
  }
}

function collectComponents(node: FigmaNode, output: FigmaNode[]) {
  if (node.type === 'COMPONENT_SET') {
    output.push(node)
    return
  }
  if (node.type === 'COMPONENT') output.push(node)
  for (const child of node.children ?? []) collectComponents(child, output)
}

interface ConvertContext {
  document: CanvasDocument
  allocate: (prefix: string, figmaId: string) => string
  componentIds: Map<string, NodeId>
  componentVariantNames: Map<string, string>
  fallbacks: RasterFallback[]
  fonts: Set<string>
}

function fallbackNode(
  node: FigmaNode,
  parent: FigmaNode | null,
  parentId: NodeId,
  order: number,
  flow: boolean,
  context: ConvertContext,
): ImageNode {
  const id = context.allocate('figma_image', node.id)
  const layout =
    layoutFor(node, parent, flow) ?? defaultLayout(100, 100, { position: flow ? 'flow' : 'absolute' })
  const image: ImageNode = {
    id,
    type: 'image',
    name: node.name,
    parentId,
    order,
    hidden: node.visible === false,
    locked: false,
    rotation: finite(node.rotation),
    layout,
    style: defaultStyle({ opacity: alpha(node.opacity), overflow: 'hidden' }),
    responsive: {},
    interactions: [],
    src: TRANSPARENT_IMAGE,
    alt: node.name,
    fit: 'fill',
    metadata: {
      figmaNodeId: node.id,
      figmaFallback: true,
    },
  }
  context.fallbacks.push({ figmaNodeId: node.id, canvasNodeId: id })
  return image
}

function convertNode(
  node: FigmaNode,
  parent: FigmaNode | null,
  parentId: NodeId,
  order: number,
  flow: boolean,
  context: ConvertContext,
): CanvasNode {
  const layout = layoutFor(node, parent, flow)
  const style = styleFor(node, context.fonts)
  if (
    !layout ||
    !style ||
    node.visible === false ||
    node.isMask ||
    node.children?.some((child) => child.isMask) ||
    node.characterStyleOverrides?.some((override) => override !== 0)
  ) {
    return fallbackNode(node, parent, parentId, order, flow, context)
  }

  const id = context.allocate('figma', node.id)
  const base = {
    id,
    name: node.name,
    parentId,
    order,
    hidden: false,
    locked: false,
    rotation: finite(node.rotation),
    layout,
    style,
    responsive: {},
    interactions: [],
    metadata: { figmaNodeId: node.id },
  }
  if (node.type === 'TEXT' && node.characters != null) {
    return createTextNode(node.characters, {
      ...base,
      runs: [],
    })
  }
  if (node.type === 'INSTANCE') {
    const componentId = node.componentId
      ? context.componentIds.get(node.componentId)
      : undefined
    if (!componentId) {
      return fallbackNode(node, parent, parentId, order, flow, context)
    }
    const variant =
      (node.componentId
        ? context.componentVariantNames.get(node.componentId)
        : undefined) ??
      Object.values(node.componentProperties ?? {})
        .map((property) => String(property.value))
        .join(' / ')
    const component = context.document.nodes[componentId]
    const mappedVariant =
      component?.type === 'component' && component.variants.includes(variant)
        ? variant
        : component?.type === 'component'
          ? component.defaultVariant
          : undefined
    return {
      ...base,
      type: 'instance',
      componentId,
      ...(mappedVariant ? { variant: mappedVariant } : {}),
      overrides: {},
    }
  }
  if (node.type === 'RECTANGLE' || node.type === 'ELLIPSE' || node.type === 'LINE') {
    return {
      ...base,
      type: 'shape',
      shape:
        node.type === 'ELLIPSE'
          ? 'ellipse'
          : node.type === 'LINE'
            ? 'line'
            : 'rectangle',
    }
  }
  if (
    ['VECTOR', 'STAR', 'POLYGON', 'BOOLEAN_OPERATION'].includes(node.type) &&
    node.fillGeometry?.length
  ) {
    const fill = style.fills[0]
    const vectorFill: CanvasColor | undefined =
      fill?.type === 'solid' ? fill.color : undefined
    return {
      ...base,
      type: 'vector',
      viewBox: `0 0 ${Math.max(1, node.absoluteBoundingBox!.width)} ${Math.max(1, node.absoluteBoundingBox!.height)}`,
      paths: node.fillGeometry.map((geometry) => ({
        d: geometry.path,
        ...(vectorFill ? { fill: vectorFill } : {}),
      })),
    }
  }
  if (
    [
      'FRAME',
      'GROUP',
      'SECTION',
      'COMPONENT',
      'COMPONENT_SET',
      'TRANSFORM_GROUP',
    ].includes(node.type)
  ) {
    return {
      ...createFrameNode(node.name, base),
      semanticTag: semanticTag(node),
    }
  }
  return fallbackNode(node, parent, parentId, order, flow, context)
}

function convertChildren(
  parent: FigmaNode,
  parentId: NodeId,
  context: ConvertContext,
) {
  const flow =
    parent.layoutMode === 'HORIZONTAL' || parent.layoutMode === 'VERTICAL'
  let order = DEFAULT_ORDER_STEP
  for (const child of parent.children ?? []) {
    if (child.visible === false || !child.absoluteBoundingBox) continue
    if (child.type === 'COMPONENT' || child.type === 'COMPONENT_SET') continue
    const converted = convertNode(
      child,
      parent,
      parentId,
      order,
      flow,
      context,
    )
    context.document.nodes[converted.id] = converted
    if (
      ['frame', 'group'].includes(converted.type) &&
      converted.metadata?.figmaFallback !== true
    ) {
      convertChildren(child, converted.id, context)
    }
    order += DEFAULT_ORDER_STEP
  }
}

function canvasTypeForFigmaNode(
  node: FigmaNode,
): CanvasNode['type'] | null {
  if (node.type === 'TEXT') return 'text'
  if (node.type === 'INSTANCE') return 'instance'
  if (node.type === 'RECTANGLE' || node.type === 'ELLIPSE' || node.type === 'LINE') {
    return 'shape'
  }
  if (
    ['VECTOR', 'STAR', 'POLYGON', 'BOOLEAN_OPERATION'].includes(node.type) &&
    node.fillGeometry?.length
  ) {
    return 'vector'
  }
  if (
    [
      'FRAME',
      'GROUP',
      'SECTION',
      'COMPONENT',
      'COMPONENT_SET',
      'TRANSFORM_GROUP',
    ].includes(node.type)
  ) {
    return 'frame'
  }
  return null
}

function variantPatch(
  base: CanvasNode,
  variant: FigmaNode,
  parent: FigmaNode | null,
  flow: boolean,
  context: ConvertContext,
  includeName = true,
): NodePatch | null {
  const expectedType = canvasTypeForFigmaNode(variant)
  if (
    base.type !== 'component' &&
    (!expectedType || expectedType !== base.type)
  ) {
    return null
  }
  const layout = layoutFor(variant, parent, flow)
  const style = styleFor(variant, context.fonts)
  if (!layout || !style) return null
  const patch: NodePatch = {}
  if (includeName && base.name !== variant.name) patch.name = variant.name
  const rotation = finite(variant.rotation)
  if (base.rotation !== rotation) patch.rotation = rotation
  if (JSON.stringify(base.layout) !== JSON.stringify(layout)) {
    patch.layout = layout
  }
  if (JSON.stringify(base.style) !== JSON.stringify(style)) {
    patch.style = style
  }
  if (
    base.type === 'text' &&
    variant.type === 'TEXT' &&
    base.text !== (variant.characters ?? '')
  ) {
    patch.text = variant.characters ?? ''
    patch.runs = []
  }
  if (base.type === 'frame') {
    const tag = semanticTag(variant)
    if (base.semanticTag !== tag) patch.semanticTag = tag
  }
  if (base.type === 'instance' && variant.type === 'INSTANCE') {
    const component = context.document.nodes[base.componentId]
    const nextVariant =
      (variant.componentId
        ? context.componentVariantNames.get(variant.componentId)
        : undefined) ??
      Object.values(variant.componentProperties ?? {})
        .map((property) => String(property.value))
        .join(' / ')
    if (
      component?.type === 'component' &&
      component.variants.includes(nextVariant) &&
      base.variant !== nextVariant
    ) {
      patch.variant = nextVariant
    }
  }
  return Object.keys(patch).length > 0 ? patch : null
}

function componentVariantOverrides(
  component: ComponentNode,
  source: FigmaNode,
  variant: FigmaNode,
  context: ConvertContext,
) {
  const overrides: Record<NodeId, NodePatch> = {}
  const rootPatch = variantPatch(
    component,
    variant,
    null,
    false,
    context,
    false,
  )
  if (rootPatch) overrides[component.id] = rootPatch
  const byFigmaId = new Map(
    Object.values(context.document.nodes)
      .map((node) => [node.metadata?.figmaNodeId, node] as const)
      .filter(
        (entry): entry is readonly [string, CanvasNode] =>
          typeof entry[0] === 'string',
      ),
  )
  const walk = (baseParent: FigmaNode, variantParent: FigmaNode) => {
    const baseChildren = (baseParent.children ?? []).filter(
      (child) =>
        child.visible !== false &&
        !!child.absoluteBoundingBox &&
        child.type !== 'COMPONENT' &&
        child.type !== 'COMPONENT_SET',
    )
    const variantChildren = (variantParent.children ?? []).filter(
      (child) =>
        child.visible !== false &&
        !!child.absoluteBoundingBox &&
        child.type !== 'COMPONENT' &&
        child.type !== 'COMPONENT_SET',
    )
    const flow =
      variantParent.layoutMode === 'HORIZONTAL' ||
      variantParent.layoutMode === 'VERTICAL'
    for (
      let index = 0;
      index < Math.min(baseChildren.length, variantChildren.length);
      index += 1
    ) {
      const baseChild = baseChildren[index]!
      const variantChild = variantChildren[index]!
      const canvasNode = byFigmaId.get(baseChild.id)
      if (!canvasNode) continue
      const patch = variantPatch(
        canvasNode,
        variantChild,
        variantParent,
        flow,
        context,
      )
      if (patch) overrides[canvasNode.id] = patch
      if (
        ['frame', 'group'].includes(canvasNode.type) &&
        canvasNode.type !== 'instance'
      ) {
        walk(baseChild, variantChild)
      }
    }
  }
  walk(source, variant)
  return overrides
}

function pageRight(document: CanvasDocument) {
  return Object.values(document.nodes)
    .filter((node): node is PageNode => node.type === 'page')
    .reduce((right, page) => {
      const width =
        page.layout.width.unit === 'px'
          ? page.layout.width.value
          : page.viewport.width
      return Math.max(right, page.layout.x + width)
    }, 0)
}

export function convertFigmaFile(
  payload: FigmaFilePayload,
  nodeId: string | null,
  baseDocument = createCanvasDocument(payload.name),
): FigmaConversion {
  const roots = importRoots(payload, nodeId)
  const nodeCount = roots.reduce((sum, root) => sum + countNodes(root.node), 0)
  if (nodeCount > MAX_NODES) {
    return fail(
      `This selection has more than ${MAX_NODES.toLocaleString()} layers. Paste a link to a smaller frame.`,
      'TOO_LARGE',
    )
  }
  const document = structuredClone(baseDocument)
  const allocate = createIdAllocator(document)
  const componentIds = new Map<string, NodeId>()
  const componentVariantNames = new Map<string, string>()
  const components: FigmaNode[] = []
  for (const root of roots) collectComponents(root.node, components)
  for (const component of components) {
    const componentId = allocate('figma_component', component.id)
    componentIds.set(component.id, componentId)
    if (component.type === 'COMPONENT_SET') {
      for (const variant of component.children ?? []) {
        if (variant.type !== 'COMPONENT') continue
        componentIds.set(variant.id, componentId)
        componentVariantNames.set(variant.id, variant.name)
      }
    }
  }
  const context: ConvertContext = {
    document,
    allocate,
    componentIds,
    componentVariantNames,
    fallbacks: [],
    fonts: new Set<string>(),
  }

  let rootOrder =
    (orderedChildren(document, null).at(-1)?.order ?? 0) + DEFAULT_ORDER_STEP
  for (const component of components) {
    const seenVariants = new Set<string>()
    const variantSources =
      component.type === 'COMPONENT_SET'
        ? (component.children ?? []).filter(
            (child) =>
              child.type === 'COMPONENT' &&
              child.visible !== false &&
              !!child.absoluteBoundingBox &&
              !seenVariants.has(child.name) &&
              !!seenVariants.add(child.name),
          )
        : [component]
    const source =
      variantSources[0] ?? component
    const bounds = source.absoluteBoundingBox ?? component.absoluteBoundingBox
    if (!bounds) continue
    const componentId = componentIds.get(component.id)!
    const variants =
      component.type === 'COMPONENT_SET'
        ? variantSources.map((variant) => variant.name).slice(0, 100)
        : ['default']
    const sourceStyle = styleFor(source, context.fonts)
    const rasterizeComponent =
      !sourceStyle ||
      source.isMask ||
      source.children?.some((child) => child.isMask) === true ||
      source.characterStyleOverrides?.some((override) => override !== 0) === true
    const mapped: ComponentNode = {
      id: componentId,
      type: 'component',
      name: component.name,
      parentId: null,
      order: rootOrder,
      hidden: false,
      locked: false,
      rotation: finite(source.rotation),
      layout:
        layoutFor(source, null, false) ??
        defaultLayout(bounds.width, bounds.height),
      style: sourceStyle ?? defaultStyle(),
      responsive: {},
      interactions: [],
      variants: variants.length > 0 ? variants : ['default'],
      defaultVariant: variants[0] ?? 'default',
      variantOverrides: {},
      metadata: { figmaNodeId: component.id },
    }
    document.nodes[mapped.id] = mapped
    if (rasterizeComponent) {
      const defaultFallback = fallbackNode(
        source,
        null,
        mapped.id,
        DEFAULT_ORDER_STEP,
        true,
        context,
      )
      defaultFallback.layout = {
        ...defaultFallback.layout,
        x: 0,
        y: 0,
        width: { unit: 'fill' },
        height: { unit: 'fill' },
      }
      document.nodes[defaultFallback.id] = defaultFallback
      for (const [index, variant] of variantSources.slice(1, 100).entries()) {
        const fallback = fallbackNode(
          variant,
          null,
          mapped.id,
          (index + 2) * DEFAULT_ORDER_STEP,
          true,
          context,
        )
        fallback.hidden = true
        fallback.layout = {
          ...fallback.layout,
          x: 0,
          y: 0,
          width: { unit: 'fill' },
          height: { unit: 'fill' },
        }
        document.nodes[fallback.id] = fallback
        mapped.variantOverrides[variant.name] = {
          [defaultFallback.id]: { hidden: true },
          [fallback.id]: { hidden: false },
        }
      }
    } else {
      convertChildren(source, mapped.id, context)
      for (const [index, variant] of variantSources
        .slice(1, 100)
        .entries()) {
        const variantStyle = styleFor(variant, context.fonts)
        const rasterizeVariant =
          !variantStyle ||
          variant.isMask ||
          variant.children?.some((child) => child.isMask) === true ||
          variant.characterStyleOverrides?.some(
            (override) => override !== 0,
          ) === true
        if (!rasterizeVariant) {
          mapped.variantOverrides[variant.name] =
            componentVariantOverrides(
              mapped,
              source,
              variant,
              context,
            )
          continue
        }
        const fallback = fallbackNode(
          variant,
          null,
          mapped.id,
          (orderedChildren(document, mapped.id).length + index + 1) *
            DEFAULT_ORDER_STEP,
          true,
          context,
        )
        fallback.hidden = true
        fallback.layout = {
          ...fallback.layout,
          x: 0,
          y: 0,
          width: { unit: 'fill' },
          height: { unit: 'fill' },
        }
        const overrides: Record<NodeId, NodePatch> = {
          [mapped.id]: { style: defaultStyle({ overflow: 'hidden' }) },
          [fallback.id]: { hidden: false },
        }
        for (const child of orderedChildren(document, mapped.id)) {
          overrides[child.id] = { hidden: true }
        }
        document.nodes[fallback.id] = fallback
        mapped.variantOverrides[variant.name] = overrides
      }
    }
    rootOrder += DEFAULT_ORDER_STEP
  }

  let x = pageRight(document)
  if (Object.values(document.nodes).some((node) => node.type === 'page')) x += PAGE_GAP
  const pageNames = new Map<string, number>()
  for (const { pageName, node } of roots) {
    const bounds = node.absoluteBoundingBox!
    const duplicate = pageNames.get(pageName) ?? 0
    pageNames.set(pageName, duplicate + 1)
    const name =
      roots.length > 1
        ? `${pageName} / ${node.name}`
        : node.name
    const pageId = allocate('figma_page', node.id)
    const rootStyle = styleFor(node, context.fonts)
    const rasterizeRoot =
      !rootStyle ||
      node.isMask ||
      node.children?.some((child) => child.isMask) === true ||
      node.characterStyleOverrides?.some((override) => override !== 0) === true
    const pageStyle = rasterizeRoot ? defaultStyle({
      fills: [{ type: 'solid', color: '#ffffff' }],
      overflow: 'hidden',
    }) : rootStyle
    const page = createPageNode(name, {
      id: pageId,
      order: rootOrder,
      layout: defaultLayout(bounds.width, bounds.height, {
        x,
        y: 40,
      }),
      style: pageStyle,
      viewport: {
        width: Math.max(1, bounds.width),
        minHeight: Math.max(1, bounds.height),
      },
      metadata: {
        figmaNodeId: node.id,
        figmaPageName: pageName,
      },
    })
    document.nodes[page.id] = page
    if (rasterizeRoot) {
      const fallback = fallbackNode(
        node,
        null,
        page.id,
        DEFAULT_ORDER_STEP,
        true,
        context,
      )
      fallback.layout = {
        ...fallback.layout,
        position: 'flow',
        x: 0,
        y: 0,
        width: { unit: 'fill' },
        height: { unit: 'fill' },
      }
      document.nodes[fallback.id] = fallback
    } else if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
      const componentId = componentIds.get(node.id)
      if (componentId) {
        const instanceId = allocate('figma_instance', node.id)
        document.nodes[instanceId] = {
          id: instanceId,
          type: 'instance',
          name: `${node.name} instance`,
          parentId: page.id,
          order: DEFAULT_ORDER_STEP,
          hidden: false,
          locked: false,
          rotation: 0,
          layout: defaultLayout(bounds.width, bounds.height, {
            position: 'flow',
            width: { unit: 'fill' },
            height: { unit: 'fill' },
          }),
          style: defaultStyle(),
          responsive: {},
          interactions: [],
          componentId,
          overrides: {},
        }
      }
    } else if (
      ['FRAME', 'GROUP', 'SECTION', 'TRANSFORM_GROUP'].includes(node.type)
    ) {
      convertChildren(node, page.id, context)
    } else {
      const child = convertNode(
        node,
        null,
        page.id,
        DEFAULT_ORDER_STEP,
        true,
        context,
      )
      child.layout = {
        ...child.layout,
        position: 'flow',
        x: 0,
        y: 0,
        width: { unit: 'fill' },
      }
      document.nodes[child.id] = child
    }
    x += bounds.width + PAGE_GAP
    rootOrder += DEFAULT_ORDER_STEP
  }
  document.metadata.updatedAt = Date.now()
  assertDocument(document)
  return {
    document,
    fallbacks: context.fallbacks,
    fonts: [...context.fonts].sort(),
    pages: pageNames.size,
    frames: roots.length,
  }
}

async function figmaApi<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://api.figma.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after')) || undefined
    throw new FigmaIntegrationError(
      retryAfter
        ? `Figma rate limit reached. Try again in ${retryAfter} seconds.`
        : 'Figma rate limit reached. Try again later.',
      'RATE_LIMITED',
      429,
      retryAfter,
      response.headers.get('x-figma-upgrade-link') || undefined,
    )
  }
  if (response.status === 401) {
    throw new FigmaIntegrationError(
      'Reconnect Figma to continue.',
      'RECONNECT_REQUIRED',
      401,
    )
  }
  if (response.status === 403) {
    throw new FigmaIntegrationError(
      'Your Figma account cannot access this file.',
      'ACCESS_DENIED',
      403,
    )
  }
  if (response.status === 404) {
    throw new FigmaIntegrationError(
      'The Figma file could not be found.',
      'INVALID_FILE',
      404,
    )
  }
  const payload = (await response.json().catch(() => ({}))) as T & { err?: string }
  if (!response.ok) {
    throw new FigmaIntegrationError(
      payload.err || 'Figma could not load this file.',
      'FIGMA_ERROR',
      response.status,
    )
  }
  return payload
}

async function renderFallbacks(
  fileKey: string,
  fallbacks: RasterFallback[],
  token: string,
) {
  const rendered: RenderedAsset[] = []
  let total = 0
  for (let index = 0; index < fallbacks.length; index += FALLBACK_BATCH_SIZE) {
    const batch = fallbacks.slice(index, index + FALLBACK_BATCH_SIZE)
    const ids = batch.map((fallback) => fallback.figmaNodeId)
    const payload = await figmaApi<{ images: Record<string, string | null> }>(
      `/v1/images/${encodeURIComponent(fileKey)}?ids=${encodeURIComponent(ids.join(','))}&format=png&scale=2`,
      token,
    )
    for (const fallback of batch) {
      const url = payload.images[fallback.figmaNodeId]
      if (!url) {
        throw new FigmaIntegrationError(
          `Figma could not render "${fallback.figmaNodeId}".`,
          'FIGMA_ERROR',
        )
      }
      const response = await fetch(url)
      if (!response.ok) {
        throw new FigmaIntegrationError(
          'A Figma fallback image could not be downloaded.',
          'FIGMA_ERROR',
        )
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.length > MAX_ASSET_BYTES) {
        throw new FigmaIntegrationError(
          'A rendered Figma layer is larger than 5 MB.',
          'TOO_LARGE',
        )
      }
      total += bytes.length
      if (total > MAX_TOTAL_ASSET_BYTES) {
        throw new FigmaIntegrationError(
          'Rendered Figma fallbacks exceed 25 MB.',
          'TOO_LARGE',
        )
      }
      rendered.push({
        id: `a${crypto.randomUUID().replaceAll('-', '')}`,
        nodeId: fallback.figmaNodeId,
        name: `Figma — ${fallback.figmaNodeId}.png`,
        mediaType: 'image/png',
        bytes,
      })
    }
  }
  return rendered
}

async function readTarget(
  userId: string,
  target: FigmaImportTarget,
): Promise<CanvasDocument> {
  const row = target.draftId
    ? await db
        .select({
          version: designDraft.canvasVersion,
          document: designDraft.canvasDocument,
          revision: designDraft.revision,
          status: designDraft.status,
        })
        .from(designDraft)
        .where(
          and(
            eq(designDraft.id, target.draftId),
            eq(designDraft.designId, target.id),
            eq(designDraft.userId, userId),
          ),
        )
        .limit(1)
        .then((rows) => rows[0])
    : await db
        .select({
          version: design.canvasVersion,
          document: design.canvasDocument,
          revision: design.revision,
        })
        .from(design)
        .where(and(eq(design.id, target.id), eq(design.userId, userId)))
        .limit(1)
        .then((rows) => rows[0])
  if (!row) {
    throw new FigmaIntegrationError('The target design no longer exists.', 'INVALID_FILE')
  }
  if ('status' in row && row.status !== 'active') {
    throw new FigmaIntegrationError('The target branch is read-only.', 'INVALID_FILE')
  }
  if (
    row.revision !== target.revision ||
    row.version !== CANVAS_SCHEMA_VERSION ||
    !row.document
  ) {
    throw new FigmaIntegrationError(
      'The target changed or uses an unsupported legacy format. Reload it and try again.',
      'INVALID_FILE',
    )
  }
  return assertDocument(row.document)
}

export async function importFigmaDesign(
  userId: string,
  url: string,
  target?: FigmaImportTarget,
) {
  const reference = parseFigmaFileUrl(url)
  const token = await getFigmaAccessToken(userId)
  const payload = await figmaApi<FigmaFilePayload>(
    `/v1/files/${encodeURIComponent(reference.key)}?geometry=paths`,
    token,
  )
  if (payload.editorType && payload.editorType !== 'figma') {
    throw new FigmaIntegrationError(
      'Only Figma Design files can be imported.',
      'INVALID_FILE',
    )
  }
  const fileName = payload.name.trim() || 'Figma import'
  const base = target
    ? await readTarget(userId, target)
    : createCanvasDocument(fileName.slice(0, 200))
  const converted = convertFigmaFile(payload, reference.nodeId, base)
  const rendered = await renderFallbacks(reference.key, converted.fallbacks, token)
  const document = structuredClone(converted.document)
  for (const item of rendered) {
    const fallback = converted.fallbacks.find(
      (entry) => entry.figmaNodeId === item.nodeId,
    )
    if (!fallback) continue
    const node = document.nodes[fallback.canvasNodeId]
    if (node?.type === 'image') node.src = `/api/asset/${item.id}`
  }
  assertDocument(document)

  const designId = target?.id ?? `d${crypto.randomUUID().replaceAll('-', '')}`
  document.id = designId
  const designName = target?.name ?? fileName.slice(0, 200)
  document.name = designName
  const versionId = `v${crypto.randomUUID().replaceAll('-', '')}`
  const writtenKeys: string[] = []
  const storage = s3
  const storedAssets = [] as {
    id: string
    userId: string
    name: string
    mediaType: string
    size: number
    storageKey: string | null
    data: string | null
  }[]

  try {
    for (const item of rendered) {
      const key = storage ? assetKey(userId, item.id) : null
      if (key && storage) {
        await storage.write(key, item.bytes, { type: item.mediaType })
        writtenKeys.push(key)
      }
      storedAssets.push({
        id: item.id,
        userId,
        name: item.name,
        mediaType: item.mediaType,
        size: item.bytes.length,
        storageKey: key,
        data: key ? null : Buffer.from(item.bytes).toString('base64'),
      })
    }
    const now = new Date()
    await db.transaction(async (tx) => {
      if (storedAssets.length > 0) await tx.insert(asset).values(storedAssets)
      if (target?.draftId) {
        const [updated] = await tx
          .update(designDraft)
          .set({
            canvasVersion: CANVAS_SCHEMA_VERSION,
            canvasDocument: document,
            revision: target.revision + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(designDraft.id, target.draftId),
              eq(designDraft.designId, target.id),
              eq(designDraft.userId, userId),
              eq(designDraft.status, 'active'),
              eq(designDraft.revision, target.revision),
            ),
          )
          .returning({ id: designDraft.id })
        if (!updated) {
          throw new FigmaIntegrationError(
            'The target branch changed during import. Reload it and try again.',
            'INVALID_FILE',
          )
        }
      } else if (target) {
        const [updated] = await tx
          .update(design)
          .set({
            name: designName,
            canvasVersion: CANVAS_SCHEMA_VERSION,
            canvasDocument: document,
            revision: target.revision + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(design.id, target.id),
              eq(design.userId, userId),
              eq(design.revision, target.revision),
            ),
          )
          .returning({ id: design.id })
        if (!updated) {
          throw new FigmaIntegrationError(
            'Main changed during import. Reload it and try again.',
            'INVALID_FILE',
          )
        }
      } else {
        await tx.insert(design).values({
          id: designId,
          userId,
          name: designName,
          shapes: [],
          pages: [],
          canvasVersion: CANVAS_SCHEMA_VERSION,
          canvasDocument: document,
          createdAt: now,
          updatedAt: now,
        })
      }

      await tx.insert(designVersion).values({
        id: versionId,
        designId,
        draftId: target?.draftId ?? null,
        userId,
        message: 'Imported from Figma',
        shapes: [],
        pages: [],
        canvasVersion: CANVAS_SCHEMA_VERSION,
        canvasDocument: document,
        ...diffDocuments(base, document),
        createdAt: now,
      })
    })

    return {
      design: {
        id: designId,
        name: designName,
        document,
        revision: target ? target.revision + 1 : 0,
        updatedAt: Date.now(),
      },
      summary: {
        pages: converted.pages,
        frames: converted.frames,
        fallbacks: converted.fallbacks.length,
        missingFonts: converted.fonts.filter(
          (font) => !AVAILABLE_FONTS.has(font.toLowerCase()),
        ),
      } satisfies FigmaImportSummary,
    }
  } catch (error) {
    if (storage) {
      await Promise.all(
        writtenKeys.map((key) => storage.delete(key).catch(() => undefined)),
      )
    }
    throw error
  }
}
