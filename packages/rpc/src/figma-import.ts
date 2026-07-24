import { Buffer } from 'node:buffer'
import { and, eq } from 'drizzle-orm'
import { db } from '@loora/db'
import { asset, design, designDraft, designVersion } from '@loora/db/schema'
import type { CanvasElement } from '@loora/db/canvas'
import {
  FigmaIntegrationError,
  getFigmaAccessToken,
} from '@loora/auth/figma'
import { assetKey, s3 } from './storage'

const MAX_ROOTS = 100
const MAX_NODES = 10_000
const MAX_CODE_BYTES = 200_000
const MAX_ASSET_BYTES = 5 * 1024 * 1024
const MAX_TOTAL_ASSET_BYTES = 25 * 1024 * 1024
const MAX_FALLBACKS = 100
const PAGE_GAP = 160
const FALLBACK_BATCH_SIZE = 50

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
  shapes: CanvasElement[]
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
  letterSpacing?: number
  textAlignHorizontal?: string
  textCase?: string
  textDecoration?: string
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
  strokeTopWeight?: number
  strokeRightWeight?: number
  strokeBottomWeight?: number
  strokeLeftWeight?: number
  cornerRadius?: number
  rectangleCornerRadii?: number[]
  effects?: FigmaEffect[]
  characters?: string
  style?: FigmaTextStyle
  characterStyleOverrides?: number[]
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

interface DraftShape extends CanvasElement {
  fallbackNodeIds: string[]
  rootNodeId: string
  rootFallbackCode: string
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
  if (url.protocol !== 'https:' || !['figma.com', 'www.figma.com'].includes(url.hostname)) {
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

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function px(value: unknown): string {
  return `${Math.round(finite(value) * 100) / 100}px`
}

function alpha(value: unknown, fallback = 1): number {
  return Math.max(0, Math.min(1, finite(value, fallback)))
}

function color(value: FigmaColor | undefined, opacity = 1): string {
  if (!value) return 'transparent'
  return `rgba(${Math.round(alpha(value.r) * 255)}, ${Math.round(alpha(value.g) * 255)}, ${Math.round(alpha(value.b) * 255)}, ${alpha((value.a ?? 1) * opacity)})`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function styleAttribute(styles: string[]): string {
  return escapeHtml(styles.filter(Boolean).join(';'))
}

function visiblePaints(value: FigmaNode['fills']): FigmaPaint[] | null {
  if (!Array.isArray(value)) return value == null ? [] : null
  return value.filter((paint) => paint.visible !== false && alpha(paint.opacity) > 0)
}

function gradientCss(paint: FigmaPaint): string | null {
  const stops = paint.gradientStops
  if (!stops?.length) return null
  const stopCss = stops
    .map((stop) => `${color(stop.color, paint.opacity)} ${Math.round(stop.position * 10000) / 100}%`)
    .join(', ')
  if (paint.type === 'GRADIENT_LINEAR') {
    const [start, end] = paint.gradientHandlePositions ?? []
    const angle = start && end
      ? Math.atan2(end.y - start.y, end.x - start.x) * (180 / Math.PI) + 90
      : 180
    return `linear-gradient(${Math.round(angle * 100) / 100}deg, ${stopCss})`
  }
  if (paint.type === 'GRADIENT_RADIAL') return `radial-gradient(ellipse, ${stopCss})`
  if (paint.type === 'GRADIENT_ANGULAR') return `conic-gradient(${stopCss})`
  return null
}

function backgroundCss(node: FigmaNode): string | null {
  const paints = visiblePaints(node.fills)
  if (paints == null) return null
  if (paints.length === 0) return 'transparent'
  if (paints.length > 1) return null
  const layers: string[] = []
  for (const paint of paints) {
    if (paint.type === 'SOLID') layers.push(color(paint.color, paint.opacity))
    else {
      const gradient = gradientCss(paint)
      if (!gradient) return null
      layers.push(gradient)
    }
  }
  return layers.reverse().join(', ')
}

function borderCss(node: FigmaNode): string[] | null {
  const paints = visiblePaints(node.strokes)
  if (paints == null) return null
  if (paints.length === 0) return []
  const paint = paints[0]
  if (paints.length > 1 || paint.type !== 'SOLID') return null
  const borderColor = color(paint.color, paint.opacity)
  const uniform = finite(node.strokeWeight, 0)
  if (uniform > 0) return [`border:${px(uniform)} solid ${borderColor}`]
  const sides = [
    ['top', node.strokeTopWeight],
    ['right', node.strokeRightWeight],
    ['bottom', node.strokeBottomWeight],
    ['left', node.strokeLeftWeight],
  ] as const
  return sides
    .filter(([, weight]) => finite(weight, 0) > 0)
    .map(([side, weight]) => `border-${side}:${px(weight)} solid ${borderColor}`)
}

function radiusCss(node: FigmaNode): string | null {
  if (typeof node.cornerRadius === 'number') return px(node.cornerRadius)
  if (node.rectangleCornerRadii?.length === 4) {
    return node.rectangleCornerRadii.map(px).join(' ')
  }
  return null
}

function effectCss(node: FigmaNode): string[] | null {
  const shadows: string[] = []
  for (const effect of node.effects ?? []) {
    if (effect.visible === false) continue
    if (effect.type !== 'DROP_SHADOW' && effect.type !== 'INNER_SHADOW') return null
    shadows.push([
      effect.type === 'INNER_SHADOW' ? 'inset' : '',
      px(effect.offset?.x),
      px(effect.offset?.y),
      px(effect.radius),
      px(effect.spread),
      color(effect.color),
    ].filter(Boolean).join(' '))
  }
  return shadows.length ? [`box-shadow:${shadows.join(',')}`] : []
}

function commonStyles(node: FigmaNode, parent: FigmaBounds, root = false): string[] | null {
  const bounds = node.absoluteBoundingBox
  if (!bounds) return null
  const background = backgroundCss(node)
  const border = borderCss(node)
  const effects = effectCss(node)
  if (background == null || border == null || effects == null || node.isMask) return null
  const styles = [
    `position:${root ? 'relative' : 'absolute'}`,
    !root ? `left:${px(bounds.x - parent.x)}` : '',
    !root ? `top:${px(bounds.y - parent.y)}` : '',
    `width:${px(bounds.width)}`,
    `height:${px(bounds.height)}`,
    'box-sizing:border-box',
    `opacity:${alpha(node.opacity)}`,
    background !== 'transparent' ? `background:${background}` : '',
    node.rotation ? `transform:rotate(${finite(node.rotation)}deg)` : '',
    node.rotation ? 'transform-origin:center' : '',
    node.blendMode && !['NORMAL', 'PASS_THROUGH'].includes(node.blendMode)
      ? `mix-blend-mode:${node.blendMode.toLowerCase().replaceAll('_', '-')}`
      : '',
    node.clipsContent ? 'overflow:hidden' : '',
    ...border,
    ...effects,
  ]
  const radius = radiusCss(node)
  if (radius) styles.push(`border-radius:${radius}`)
  return styles
}

function fallbackMarkup(node: FigmaNode, parent: FigmaBounds, root = false): string {
  const bounds = node.absoluteBoundingBox!
  return `<img src="__FIGMA_ASSET_${node.id}__" alt="${escapeHtml(node.name)}" style="${styleAttribute([
    `position:${root ? 'relative' : 'absolute'}`,
    !root ? `left:${px(bounds.x - parent.x)}` : '',
    !root ? `top:${px(bounds.y - parent.y)}` : '',
    `width:${px(bounds.width)}`,
    `height:${px(bounds.height)}`,
    'display:block',
    'object-fit:contain',
    `opacity:${alpha(node.opacity)}`,
    node.rotation ? `transform:rotate(${finite(node.rotation)}deg)` : '',
  ])}" />`
}

function renderText(node: FigmaNode, parent: FigmaBounds, fonts: Set<string>): string | null {
  if (node.characterStyleOverrides?.some((override) => override !== 0)) return null
  const paints = visiblePaints(node.fills)
  if (
    paints == null ||
    paints.length > 1 ||
    (paints.length === 1 && paints[0].type !== 'SOLID')
  ) {
    return null
  }
  const styles = commonStyles(node, parent)
  if (!styles || node.characters == null) return null
  const backgroundIndex = styles.findIndex((style) => style.startsWith('background:'))
  if (backgroundIndex !== -1) styles.splice(backgroundIndex, 1)
  if (paints[0]) styles.push(`color:${color(paints[0].color, paints[0].opacity)}`)
  const text = node.style ?? {}
  if (text.fontFamily) {
    fonts.add(text.fontFamily)
    styles.push(`font-family:${JSON.stringify(text.fontFamily)},sans-serif`)
  }
  if (text.fontWeight) styles.push(`font-weight:${finite(text.fontWeight, 400)}`)
  if (text.fontSize) styles.push(`font-size:${px(text.fontSize)}`)
  if (text.lineHeightPx) styles.push(`line-height:${px(text.lineHeightPx)}`)
  if (text.letterSpacing) styles.push(`letter-spacing:${px(text.letterSpacing)}`)
  const align = text.textAlignHorizontal?.toLowerCase()
  if (align && ['left', 'center', 'right', 'justify'].includes(align)) {
    styles.push(`text-align:${align}`)
  }
  if (text.textCase === 'UPPER') styles.push('text-transform:uppercase')
  if (text.textCase === 'LOWER') styles.push('text-transform:lowercase')
  if (text.textCase === 'TITLE') styles.push('text-transform:capitalize')
  if (text.textDecoration === 'UNDERLINE') styles.push('text-decoration:underline')
  if (text.textDecoration === 'STRIKETHROUGH') styles.push('text-decoration:line-through')
  styles.push('white-space:pre-wrap', 'overflow:hidden', 'margin:0')
  return `<div style="${styleAttribute(styles)}">${escapeHtml(node.characters)}</div>`
}

const CONTAINER_TYPES = new Set([
  'FRAME',
  'GROUP',
  'SECTION',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE',
  'TRANSFORM_GROUP',
])

function renderNode(
  node: FigmaNode,
  parent: FigmaBounds,
  fallbackIds: Set<string>,
  fonts: Set<string>,
  root = false,
): string {
  if (node.visible === false || !node.absoluteBoundingBox) return ''
  if (node.type === 'TEXT') {
    const text = renderText(node, parent, fonts)
    if (text) return text
  } else if (CONTAINER_TYPES.has(node.type)) {
    const styles = node.children?.some((child) => child.isMask)
      ? null
      : commonStyles(node, parent, root)
    if (styles) {
      const children = (node.children ?? [])
        .map((child) => renderNode(child, node.absoluteBoundingBox!, fallbackIds, fonts))
        .join('')
      return `<div style="${styleAttribute(styles)}">${children}</div>`
    }
  } else if (node.type === 'RECTANGLE' || node.type === 'ELLIPSE') {
    const styles = commonStyles(node, parent)
    if (styles) {
      if (node.type === 'ELLIPSE') styles.push('border-radius:50%')
      return `<div style="${styleAttribute(styles)}"></div>`
    }
  }

  fallbackIds.add(node.id)
  return fallbackMarkup(node, parent, root)
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
      return fail('That Figma frame is missing, hidden, or not renderable.', 'INVALID_FILE')
    }
    return [{ pageName: pageForNode(payload.document, nodeId), node }]
  }
  const roots = (payload.document.children ?? []).flatMap((page) =>
    (page.children ?? [])
      .filter((node) => node.visible !== false && node.absoluteBoundingBox)
      .map((node) => ({ pageName: page.name, node })),
  )
  if (roots.length === 0) return fail('This Figma file has no visible frames to import.', 'INVALID_FILE')
  if (roots.length > MAX_ROOTS) {
    return fail(
      `This file has more than ${MAX_ROOTS} top-level layers. Paste a link to a specific frame instead.`,
      'TOO_LARGE',
    )
  }
  return roots
}

export function convertFigmaFile(
  payload: FigmaFilePayload,
  nodeId: string | null,
): { drafts: DraftShape[]; pages: number; fonts: string[] } {
  const roots = importRoots(payload, nodeId)
  const nodeCount = roots.reduce((sum, root) => sum + countNodes(root.node), 0)
  if (nodeCount > MAX_NODES) {
    return fail(
      `This selection has more than ${MAX_NODES.toLocaleString()} layers. Paste a link to a smaller frame.`,
      'TOO_LARGE',
    )
  }

  const pageNames = [...new Set(roots.map((root) => root.pageName))]
  const fonts = new Set<string>()
  const drafts: DraftShape[] = []
  let pageOffsetY = 40

  for (const pageName of pageNames) {
    const pageRoots = roots.filter((root) => root.pageName === pageName)
    const minX = Math.min(...pageRoots.map(({ node }) => node.absoluteBoundingBox!.x))
    const minY = Math.min(...pageRoots.map(({ node }) => node.absoluteBoundingBox!.y))
    const maxY = Math.max(...pageRoots.map(({ node }) => {
      const bounds = node.absoluteBoundingBox!
      return bounds.y + bounds.height
    }))

    for (const { node } of pageRoots) {
      const bounds = node.absoluteBoundingBox!
      let fallbackIds = new Set<string>()
      let code = renderNode(node, bounds, fallbackIds, fonts, true)
      if (Buffer.byteLength(code) > MAX_CODE_BYTES) {
        fallbackIds = new Set([node.id])
        code = fallbackMarkup(node, bounds, true)
      }
      drafts.push({
        id: `e${crypto.randomUUID().replaceAll('-', '')}`,
        name: pageNames.length > 1 ? `${pageName} / ${node.name}` : node.name,
        x: Math.round(bounds.x - minX + 40),
        y: Math.round(bounds.y - minY + pageOffsetY),
        w: Math.max(1, Math.round(bounds.width)),
        h: Math.max(1, Math.round(bounds.height)),
        code,
        fallbackNodeIds: [...fallbackIds],
        rootNodeId: node.id,
        rootFallbackCode: fallbackMarkup(node, bounds, true),
      })
    }
    pageOffsetY += Math.max(1, Math.round(maxY - minY)) + PAGE_GAP
  }

  const fallbackCount = drafts.reduce((sum, draft) => sum + draft.fallbackNodeIds.length, 0)
  if (fallbackCount > MAX_FALLBACKS) {
    for (const draft of drafts) {
      if (draft.fallbackNodeIds.length === 0) continue
      draft.code = draft.rootFallbackCode
      draft.fallbackNodeIds = [draft.rootNodeId]
    }
  }

  return { drafts, pages: pageNames.length, fonts: [...fonts].sort() }
}

export function placeImportedShapes(
  existing: CanvasElement[],
  imported: CanvasElement[],
): CanvasElement[] {
  if (existing.length === 0 || imported.length === 0) return imported
  const existingRight = Math.max(...existing.map((shape) => shape.x + shape.w))
  const existingTop = Math.min(...existing.map((shape) => shape.y))
  const importedLeft = Math.min(...imported.map((shape) => shape.x))
  const importedTop = Math.min(...imported.map((shape) => shape.y))
  const offsetX = existingRight + PAGE_GAP - importedLeft
  const offsetY = existingTop - importedTop
  return imported.map((shape) => ({
    ...shape,
    x: shape.x + offsetX,
    y: shape.y + offsetY,
  }))
}

async function figmaApi<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://api.figma.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after')) || undefined
    const upgradeUrl = response.headers.get('x-figma-upgrade-link') || undefined
    throw new FigmaIntegrationError(
      retryAfter
        ? `Figma rate limit reached. Try again in ${retryAfter} seconds.`
        : 'Figma rate limit reached. Try again later.',
      'RATE_LIMITED',
      429,
      retryAfter,
      upgradeUrl,
    )
  }
  if (response.status === 401) {
    throw new FigmaIntegrationError('Reconnect Figma to continue.', 'RECONNECT_REQUIRED', 401)
  }
  if (response.status === 403) {
    throw new FigmaIntegrationError(
      'Your Figma account cannot access this file.',
      'ACCESS_DENIED',
      403,
    )
  }
  if (response.status === 404) {
    throw new FigmaIntegrationError('The Figma file could not be found.', 'INVALID_FILE', 404)
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

async function resolveFallbackUrls(
  fileKey: string,
  nodeIds: string[],
  token: string,
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(nodeIds)]
  const urls = new Map<string, string>()
  for (let index = 0; index < uniqueIds.length; index += FALLBACK_BATCH_SIZE) {
    const batch = uniqueIds.slice(index, index + FALLBACK_BATCH_SIZE)
    const params = new URLSearchParams({ ids: batch.join(','), format: 'png', scale: '1' })
    const payload = await figmaApi<{ images?: Record<string, string | null>; err?: string }>(
      `/v1/images/${encodeURIComponent(fileKey)}?${params}`,
      token,
    )
    for (const id of batch) {
      const url = payload.images?.[id]
      if (url) urls.set(id, url)
    }
  }
  return urls
}

async function renderFallbacks(
  fileKey: string,
  drafts: DraftShape[],
  token: string,
): Promise<RenderedAsset[]> {
  const requestedIds = [...new Set(drafts.flatMap((draft) => draft.fallbackNodeIds))]
  const urls = await resolveFallbackUrls(fileKey, requestedIds, token)
  const missingIds = new Set(requestedIds.filter((id) => !urls.has(id)))

  if (missingIds.size) {
    for (const draft of drafts) {
      if (!draft.fallbackNodeIds.some((id) => missingIds.has(id))) continue
      draft.code = draft.rootFallbackCode
      draft.fallbackNodeIds = [draft.rootNodeId]
    }

    const replacementIds = [...new Set(drafts.flatMap((draft) => draft.fallbackNodeIds))]
      .filter((id) => !urls.has(id))
    const replacements = await resolveFallbackUrls(fileKey, replacementIds, token)
    for (const [id, url] of replacements) urls.set(id, url)
  }

  const finalIds = [...new Set(drafts.flatMap((draft) => draft.fallbackNodeIds))]
  const unrenderableId = finalIds.find((id) => !urls.has(id))
  if (unrenderableId) {
    const draft = drafts.find((item) => item.fallbackNodeIds.includes(unrenderableId))
    throw new FigmaIntegrationError(
      `Figma could not render “${draft?.name ?? 'this frame'}”. Try importing a different frame or the whole file.`,
      'INVALID_FILE',
    )
  }

  let totalBytes = 0
  const assets: RenderedAsset[] = []
  for (const nodeId of finalIds) {
    const url = urls.get(nodeId)!
    const response = await fetch(url)
    const declaredSize = Number(response.headers.get('content-length')) || 0
    if (!response.ok || (declaredSize && declaredSize > MAX_ASSET_BYTES)) {
      throw new FigmaIntegrationError(
        'A rendered Figma layer is too large to import.',
        'TOO_LARGE',
      )
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    totalBytes += bytes.length
    if (bytes.length > MAX_ASSET_BYTES || totalBytes > MAX_TOTAL_ASSET_BYTES) {
      throw new FigmaIntegrationError(
        `Imported images exceed the ${MAX_TOTAL_ASSET_BYTES / 1024 / 1024}MB limit. Paste a link to a smaller frame.`,
        'TOO_LARGE',
      )
    }
    assets.push({
      id: `a${crypto.randomUUID().replaceAll('-', '')}`,
      nodeId,
      name: `Figma layer ${nodeId}.png`,
      mediaType: 'image/png',
      bytes,
    })
  }
  return assets
}

export async function importFigmaDesign(
  userId: string,
  sourceUrl: string,
  target?: FigmaImportTarget,
) {
  const reference = parseFigmaFileUrl(sourceUrl)
  const token = await getFigmaAccessToken(userId)
  const params = new URLSearchParams()
  if (reference.nodeId) params.set('ids', reference.nodeId)
  const suffix = params.size ? `?${params}` : ''
  const payload = await figmaApi<FigmaFilePayload>(
    `/v1/files/${encodeURIComponent(reference.key)}${suffix}`,
    token,
  )
  if ((payload.editorType ?? 'figma').toLowerCase() !== 'figma') {
    throw new FigmaIntegrationError(
      'Loora currently imports Figma Design files, not FigJam or Slides.',
      'INVALID_FILE',
    )
  }

  const converted = convertFigmaFile(payload, reference.nodeId)
  const fallbackCount = converted.drafts.reduce(
    (count, draft) => count + draft.fallbackNodeIds.length,
    0,
  )
  const rendered = fallbackCount
    ? await renderFallbacks(reference.key, converted.drafts, token)
    : []
  const assetByNode = new Map(rendered.map((item) => [item.nodeId, item.id]))
  const importedShapes = converted.drafts.map(
    ({ fallbackNodeIds: _, rootNodeId: __, rootFallbackCode: ___, ...draft }) => ({
      ...draft,
      code: [...assetByNode].reduce(
        (code, [nodeId, assetId]) => code.replaceAll(`__FIGMA_ASSET_${nodeId}__`, `/api/asset/${assetId}`),
        draft.code,
      ),
    }),
  )
  if (importedShapes.some((shape) => Buffer.byteLength(shape.code) > MAX_CODE_BYTES)) {
    throw new FigmaIntegrationError('The converted Figma markup is too large.', 'TOO_LARGE')
  }

  const placedShapes = target
    ? placeImportedShapes(target.shapes, importedShapes)
    : importedShapes
  const shapes = target ? [...target.shapes, ...placedShapes] : placedShapes
  if (shapes.length > MAX_NODES) {
    throw new FigmaIntegrationError(
      `The document would contain more than ${MAX_NODES.toLocaleString()} elements. Import into a new document instead.`,
      'TOO_LARGE',
    )
  }

  const designId = target?.id ?? `d${crypto.randomUUID().replaceAll('-', '')}`
  const versionId = `v${crypto.randomUUID().replaceAll('-', '')}`
  const fileName = payload.name.trim() || 'Figma import'
  const designName = target?.name ?? (
    reference.nodeId && importedShapes.length === 1
      ? `${fileName} — ${importedShapes[0].name}`.slice(0, 200)
      : fileName.slice(0, 200)
  )
  const writtenKeys: string[] = []
  const storage = s3

  try {
    const storedAssets = [] as {
      id: string
      userId: string
      name: string
      mediaType: string
      size: number
      storageKey: string | null
      data: string | null
    }[]
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
      if (storedAssets.length) await tx.insert(asset).values(storedAssets)

      if (target?.draftId) {
        const [updated] = await tx
          .update(designDraft)
          .set({ shapes, revision: target.revision + 1, updatedAt: now })
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
            'The target draft changed during import. Reload it and try again.',
            'INVALID_FILE',
          )
        }
      } else if (target) {
        const [updated] = await tx
          .update(design)
          .set({
            name: designName,
            shapes,
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
          shapes,
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
        shapes,
        added: importedShapes.length,
        removed: 0,
        changed: 0,
        createdAt: now,
      })
    })

    return {
      design: {
        id: designId,
        name: designName,
        shapes,
        revision: target ? target.revision + 1 : 0,
        updatedAt: now.getTime(),
      },
      summary: {
        pages: converted.pages,
        frames: importedShapes.length,
        fallbacks: rendered.length,
        missingFonts: converted.fonts.filter((font) => !AVAILABLE_FONTS.has(font.toLowerCase())),
      } satisfies FigmaImportSummary,
    }
  } catch (error) {
    if (storage) {
      await Promise.all(writtenKeys.map((key) => storage.delete(key).catch(() => undefined)))
    }
    throw error
  }
}
