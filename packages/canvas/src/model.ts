import {
  isCanvasAnimation,
  isCanvasMotionTransform,
  isCanvasNodeAnimation,
  isCanvasTransition,
  MAX_ANIMATIONS,
  MAX_NODE_ANIMATIONS,
  VISUAL_STATES,
  type CanvasAnimation,
  type CanvasMotionTransform,
  type CanvasNodeAnimation,
  type CanvasTransition,
  type AnimationId,
  type VisualStateName,
} from './motion'

export * from './motion'

export const CANVAS_SCHEMA_VERSION = 2 as const
export const MAX_CANVAS_NODES = 25_000
export const DEFAULT_ORDER_STEP = 1024
export const MIN_ORDER_GAP = 1e-7

export type NodeId = string
export type BreakpointId = string
export type TokenId = string
export type ThemeId = string
export type StateId = string

export interface CanvasBreakpoint {
  id: BreakpointId
  name: string
  minWidth: number
  previewWidth: number
}

export const DEFAULT_BREAKPOINTS: CanvasBreakpoint[] = [
  { id: 'mobile', name: 'Mobile', minWidth: 0, previewWidth: 390 },
  { id: 'tablet', name: 'Tablet', minWidth: 768, previewWidth: 768 },
  { id: 'desktop', name: 'Desktop', minWidth: 1200, previewWidth: 1440 },
]

export type CanvasLength =
  | { unit: 'px'; value: number }
  | { unit: 'percent'; value: number }
  | { unit: 'fill' }
  | { unit: 'hug' }

export interface CanvasInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export type LayoutMode = 'absolute' | 'flex' | 'grid'
export type PositionMode = 'flow' | 'absolute'
/** Where a container places children on the cross axis, or a child itself. */
export type LayoutAlignment = 'start' | 'center' | 'end' | 'stretch'

export interface CanvasLayout {
  position: PositionMode
  x: number
  y: number
  width: CanvasLength
  height: CanvasLength
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  aspectRatio?: number
  mode: LayoutMode
  direction?: 'row' | 'column'
  wrap?: boolean
  gap?: number
  padding?: CanvasInsets
  align?: LayoutAlignment
  justify?: 'start' | 'center' | 'end' | 'space-between' | 'space-around'
  columns?: number
  /**
   * A child that wants a different cross-axis alignment than its parent's
   * `align` gives every sibling.
   */
  alignSelf?: LayoutAlignment
  /**
   * How this child shares free main-axis space against its siblings. Absent
   * means a `fill` child splits evenly (1) and everything else takes nothing.
   */
  grow?: number
  /**
   * How this child gives back main-axis space when the line overflows. Absent
   * means it shrinks with the rest of the line (1).
   */
  shrink?: number
}

export type CanvasColor = string | { token: TokenId }

export type CanvasPaint =
  | { type: 'solid'; color: CanvasColor }
  | {
      type: 'linear-gradient'
      angle: number
      stops: { offset: number; color: CanvasColor }[]
    }
  | {
      type: 'radial-gradient'
      /** Horizontal center, 0–1. */
      cx: number
      /** Vertical center, 0–1. */
      cy: number
      /** Optional CSS size fragment, e.g. `80% 70%` or `circle`. */
      size?: string
      stops: { offset: number; color: CanvasColor }[]
    }

export interface CanvasStroke {
  color: CanvasColor
  width: number
  style?: 'solid' | 'dashed' | 'dotted'
}

export interface CanvasShadow {
  x: number
  y: number
  blur: number
  spread: number
  color: CanvasColor
  inset?: boolean
}

export interface CanvasTypography {
  family: string
  size: number
  weight: number
  lineHeight: number
  letterSpacing: number
  align: 'left' | 'center' | 'right' | 'justify'
  wrap?: boolean
  decoration?: 'none' | 'underline' | 'line-through'
  transform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
}

export interface CanvasStyle {
  fills: CanvasPaint[]
  stroke?: CanvasStroke
  radius: number | [number, number, number, number]
  shadows: CanvasShadow[]
  opacity: number
  overflow: 'visible' | 'hidden' | 'auto'
  blendMode?: string
  typography?: CanvasTypography
}

export interface TextRun {
  start: number
  end: number
  typography?: Partial<CanvasTypography>
  color?: CanvasColor
}

export type CanvasStateValue = string | number | boolean

export interface CanvasStateDefinition {
  id: StateId
  name: string
  type: 'string' | 'number' | 'boolean'
  initial: CanvasStateValue
}

export interface CanvasStateCondition {
  stateId: StateId
  operator: 'equals' | 'not-equals'
  value: CanvasStateValue
}

export type CanvasAction =
  | { type: 'navigate'; pageId: NodeId }
  | { type: 'open-url'; url: string; target?: '_self' | '_blank' }
  | { type: 'visibility'; nodeId: NodeId; value: 'show' | 'hide' | 'toggle' }
  | { type: 'open-overlay'; pageId: NodeId }
  | { type: 'close-overlay' }
  | { type: 'set-variant'; instanceId: NodeId; variant: string }
  | { type: 'set-state'; stateId: StateId; value: CanvasStateValue }
  | { type: 'toggle-state'; stateId: StateId }
  | { type: 'increment-state'; stateId: StateId; amount: number }
  | { type: 'set-theme'; themeId: ThemeId }

export type CanvasEventTrigger =
  | 'click'
  | 'double-click'
  | 'hover'
  | 'hover-end'
  | 'submit'
  | 'change'
  | 'input'
  | 'focus'
  | 'blur'
  | 'state-change'

export interface CanvasInteraction {
  trigger: CanvasEventTrigger
  stateId?: StateId
  when?: CanvasStateCondition[]
  actions: CanvasAction[]
}

/**
 * Typography is merged field by field when a patch is applied, so an override
 * only has to carry what it changes.
 */
export type CanvasStylePatch = Partial<Omit<CanvasStyle, 'typography'>> & {
  typography?: Partial<CanvasTypography>
}

/**
 * What a node looks like while a pointer is on it, held down, or focused.
 *
 * Narrower than a node patch on purpose: a hover may restyle and move a node,
 * it may not rewrite its text or reparent it. The transform is separate from
 * the style because it is the half that costs nothing to animate — it never
 * reflows the page, which is what lets a hover run at frame rate.
 */
export interface CanvasVisualState {
  style?: CanvasStylePatch
  transform?: CanvasMotionTransform
}

export type CanvasVisualStates = Partial<Record<VisualStateName, CanvasVisualState>>

export interface NodePatch {
  name?: string
  hidden?: boolean
  locked?: boolean
  rotation?: number
  layout?: Partial<CanvasLayout>
  style?: CanvasStylePatch
  semanticTag?: SemanticTag
  text?: string
  runs?: TextRun[]
  src?: string
  alt?: string
  interactions?: CanvasInteraction[]
  variant?: string
  visualStates?: CanvasVisualStates
  transition?: CanvasTransition
  animations?: CanvasNodeAnimation[]
}

export interface NodeMutationPatch extends NodePatch {
  order?: number
  viewport?: Partial<PageNode['viewport']>
  variants?: string[]
  defaultVariant?: string
  variantOverrides?: ComponentNode['variantOverrides']
  shape?: ShapeNode['shape']
  viewBox?: string
  paths?: VectorNode['paths']
  fit?: ImageNode['fit']
  componentId?: NodeId
  overrides?: InstanceNode['overrides']
  states?: Record<StateId, CanvasStateDefinition>
  responsive?: ResponsiveOverrides
  metadata?: Record<string, unknown>
}

export type ResponsiveOverrides = Record<BreakpointId, NodePatch>

export type SemanticTag =
  | 'div'
  | 'section'
  | 'header'
  | 'nav'
  | 'main'
  | 'footer'
  | 'article'
  | 'aside'
  | 'button'
  | 'a'
  | 'form'

export type CanvasNodeType =
  | 'page'
  | 'component'
  | 'frame'
  | 'group'
  | 'text'
  | 'shape'
  | 'vector'
  | 'image'
  | 'instance'

export interface CanvasNodeBase {
  id: NodeId
  type: CanvasNodeType
  name: string
  parentId: NodeId | null
  order: number
  hidden: boolean
  locked: boolean
  rotation: number
  layout: CanvasLayout
  style: CanvasStyle
  responsive: ResponsiveOverrides
  interactions: CanvasInteraction[]
  /** How this node looks under a pointer. Absent means it does not react. */
  visualStates?: CanvasVisualStates
  /** How it travels between those looks. */
  transition?: CanvasTransition
  /** Document animations this node plays, and what starts them. */
  animations?: CanvasNodeAnimation[]
  metadata?: Record<string, unknown>
}

export interface PageNode extends CanvasNodeBase {
  type: 'page'
  states?: Record<StateId, CanvasStateDefinition>
  viewport: {
    width: number
    minHeight: number
  }
}

export interface ComponentNode extends CanvasNodeBase {
  type: 'component'
  states?: Record<StateId, CanvasStateDefinition>
  variants: string[]
  defaultVariant?: string
  variantOverrides: Record<string, Record<NodeId, NodePatch>>
}

export interface FrameNode extends CanvasNodeBase {
  type: 'frame'
  semanticTag: SemanticTag
}

export interface GroupNode extends CanvasNodeBase {
  type: 'group'
}

export interface TextNode extends CanvasNodeBase {
  type: 'text'
  text: string
  runs: TextRun[]
}

export interface ShapeNode extends CanvasNodeBase {
  type: 'shape'
  shape: 'rectangle' | 'ellipse' | 'line'
}

export interface VectorNode extends CanvasNodeBase {
  type: 'vector'
  viewBox: string
  paths: {
    d: string
    fill?: CanvasColor
    stroke?: CanvasColor
    strokeWidth?: number
  }[]
}

export interface ImageNode extends CanvasNodeBase {
  type: 'image'
  src: string
  alt: string
  fit: 'cover' | 'contain' | 'fill'
}

export interface InstanceNode extends CanvasNodeBase {
  type: 'instance'
  componentId: NodeId
  variant?: string
  overrides: Record<NodeId, NodePatch>
}

export type CanvasNode =
  | PageNode
  | ComponentNode
  | FrameNode
  | GroupNode
  | TextNode
  | ShapeNode
  | VectorNode
  | ImageNode
  | InstanceNode

export interface DesignToken {
  id: TokenId
  name: string
  type: 'color' | 'number' | 'font'
  value: string | number
  modes?: Record<string, string | number>
}

export interface CanvasTheme {
  id: ThemeId
  name: string
}

export interface CanvasDocument {
  schemaVersion: typeof CANVAS_SCHEMA_VERSION
  id: string
  name: string
  nodes: Record<NodeId, CanvasNode>
  breakpoints: CanvasBreakpoint[]
  tokens: Record<TokenId, DesignToken>
  themes: Record<ThemeId, CanvasTheme>
  activeThemeId: ThemeId
  /**
   * Named motion, referenced by nodes. Optional because every document written
   * before motion existed simply has none.
   */
  animations?: Record<AnimationId, CanvasAnimation>
  metadata: {
    createdAt: number
    updatedAt: number
    migratedFrom?: number
    migrationWarnings?: string[]
  }
}

export interface NodeRef {
  nodeId: NodeId
  instancePath: NodeId[]
}

export interface CanvasCommentPin {
  target: NodeRef
  x: number
  y: number
}

export interface DocumentValidationIssue {
  path: string
  message: string
}

export interface DocumentValidationResult {
  ok: boolean
  issues: DocumentValidationIssue[]
}

export interface CanvasRuntimeSchema<T> {
  parse: (value: unknown) => T
  safeParse: (value: unknown) =>
    | { success: true; data: T }
    | { success: false; error: Error }
}

export function canvasUuid() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const value = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20),
  ].join('-')
}

export function canvasId(prefix = 'n') {
  return `${prefix}_${canvasUuid().replaceAll('-', '')}`
}

export const px = (value: number): CanvasLength => ({ unit: 'px', value })

function withDefined<T extends object>(base: T, patch: object): T {
  const result = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      ;(result as Record<string, unknown>)[key] = value
    }
  }
  return result
}

export function defaultLayout(
  width = 320,
  height = 200,
  patch: Partial<CanvasLayout> = {},
): CanvasLayout {
  return withDefined({
    position: 'absolute',
    x: 0,
    y: 0,
    width: px(width),
    height: px(height),
    mode: 'absolute',
  } satisfies CanvasLayout, patch)
}

export function defaultStyle(patch: Partial<CanvasStyle> = {}): CanvasStyle {
  return withDefined({
    fills: [],
    radius: 0,
    shadows: [],
    opacity: 1,
    overflow: 'visible',
  } satisfies CanvasStyle, patch)
}

export function createCanvasDocument(
  name = 'Untitled',
  id = canvasId('doc'),
): CanvasDocument {
  const now = Date.now()
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    id,
    name,
    nodes: {},
    breakpoints: DEFAULT_BREAKPOINTS.map((breakpoint) => ({ ...breakpoint })),
    tokens: {},
    themes: {
      default: {
        id: 'default',
        name: 'Default',
      },
    },
    activeThemeId: 'default',
    metadata: { createdAt: now, updatedAt: now },
  }
}

export function createPageNode(
  name = 'Page',
  patch: Partial<Omit<PageNode, 'type'>> = {},
): PageNode {
  return withDefined({
    id: canvasId('page'),
    type: 'page',
    name,
    parentId: null,
    order: DEFAULT_ORDER_STEP,
    hidden: false,
    locked: false,
    rotation: 0,
    layout: defaultLayout(1440, 900),
    style: defaultStyle({ fills: [{ type: 'solid', color: '#ffffff' }], overflow: 'hidden' }),
    responsive: {},
    interactions: [],
    states: {},
    viewport: { width: 1440, minHeight: 900 },
  } satisfies PageNode, patch)
}

export function createFrameNode(
  name = 'Frame',
  patch: Partial<Omit<FrameNode, 'type'>> = {},
): FrameNode {
  return withDefined({
    id: canvasId('frame'),
    type: 'frame',
    name,
    parentId: null,
    order: DEFAULT_ORDER_STEP,
    hidden: false,
    locked: false,
    rotation: 0,
    layout: defaultLayout(),
    style: defaultStyle(),
    responsive: {},
    interactions: [],
    semanticTag: 'div',
  } satisfies FrameNode, patch)
}

export function createComponentNode(
  name = 'Component',
  patch: Partial<Omit<ComponentNode, 'type'>> = {},
): ComponentNode {
  const { semanticTag: _semanticTag, ...base } = createFrameNode(name)
  return withDefined({
    ...base,
    type: 'component',
    states: {},
    variants: ['default'],
    defaultVariant: 'default',
    variantOverrides: {},
  } satisfies ComponentNode, patch)
}

export function createInstanceNode(
  componentId: NodeId,
  name = 'Instance',
  patch: Partial<Omit<InstanceNode, 'type' | 'componentId'>> = {},
): InstanceNode {
  const { semanticTag: _semanticTag, ...base } = createFrameNode(name)
  return withDefined({
    ...base,
    type: 'instance',
    componentId,
    overrides: {},
  } satisfies InstanceNode, patch)
}

export function createVectorNode(
  name = 'Vector',
  patch: Partial<Omit<VectorNode, 'type'>> = {},
): VectorNode {
  const { semanticTag: _semanticTag, ...base } = createFrameNode(name)
  return withDefined({
    ...base,
    type: 'vector',
    viewBox: '0 0 24 24',
    paths: [],
  } satisfies VectorNode, patch)
}

export function createTextNode(
  text = 'Text',
  patch: Partial<Omit<TextNode, 'type' | 'text'>> = {},
): TextNode {
  return withDefined({
    id: canvasId('text'),
    type: 'text',
    name: text.slice(0, 40) || 'Text',
    parentId: null,
    order: DEFAULT_ORDER_STEP,
    hidden: false,
    locked: false,
    rotation: 0,
    layout: defaultLayout(240, 48, { height: { unit: 'hug' } }),
    style: defaultStyle({
      typography: {
        family: 'Archivo',
        size: 16,
        weight: 400,
        lineHeight: 1.4,
        letterSpacing: 0,
        align: 'left',
        wrap: true,
      },
    }),
    responsive: {},
    interactions: [],
    text,
    runs: [],
  } satisfies TextNode, patch)
}

/** Children of every parent, in order. Built in one pass over the nodes. */
export type CanvasChildIndex = Map<NodeId | null, CanvasNode[]>

function bySiblingOrder(left: CanvasNode, right: CanvasNode) {
  return left.order - right.order || left.id.localeCompare(right.id)
}

export function buildChildIndex(document: CanvasDocument): CanvasChildIndex {
  const index: CanvasChildIndex = new Map()
  for (const node of Object.values(document.nodes)) {
    const siblings = index.get(node.parentId)
    if (siblings) siblings.push(node)
    else index.set(node.parentId, [node])
  }
  for (const siblings of index.values()) siblings.sort(bySiblingOrder)
  return index
}

/**
 * Without an index this scans every node, so walking a whole tree one parent at
 * a time is quadratic. Anything that visits more than a couple of parents —
 * export, a subtree delete — should build one index and pass it in. The array
 * an index returns is shared; treat it as read-only.
 */
export function orderedChildren(
  document: CanvasDocument,
  parentId: NodeId | null,
  index?: CanvasChildIndex,
) {
  if (index) return index.get(parentId) ?? []
  return Object.values(document.nodes)
    .filter((node) => node.parentId === parentId)
    .sort(bySiblingOrder)
}

export function stateDefinitionsForNode(
  document: CanvasDocument,
  nodeId: NodeId,
) {
  let node: CanvasNode | undefined = document.nodes[nodeId]
  const seen = new Set<NodeId>()
  while (node && !seen.has(node.id)) {
    seen.add(node.id)
    if (node.type === 'page' || node.type === 'component') {
      return node.states ?? {}
    }
    node = node.parentId ? document.nodes[node.parentId] : undefined
  }
  return {}
}

export function findBreakpoint(document: CanvasDocument, width: number) {
  return [...document.breakpoints]
    .sort((left, right) => left.minWidth - right.minWidth)
    .filter((breakpoint) => breakpoint.minWidth <= width)
    .at(-1)
}

function mergeLayout(layout: CanvasLayout, patch: Partial<CanvasLayout> | undefined): CanvasLayout {
  if (!patch) return layout
  return {
    ...layout,
    ...patch,
    padding: patch.padding ? { ...(layout.padding ?? { top: 0, right: 0, bottom: 0, left: 0 }), ...patch.padding } : layout.padding,
  }
}

function mergeStyle(style: CanvasStyle, patch: CanvasStylePatch | undefined): CanvasStyle {
  if (!patch) return style
  return {
    ...style,
    ...patch,
    typography:
      patch.typography === undefined
        ? style.typography
        : {
            ...style.typography,
            ...patch.typography,
          } as CanvasTypography,
  }
}

export function applyNodePatch(
  node: CanvasNode,
  patch: NodePatch | undefined,
): CanvasNode {
  if (!patch) return node
  return {
    ...node,
    ...patch,
    layout: mergeLayout(node.layout, patch.layout),
    style: mergeStyle(node.style, patch.style),
  } as CanvasNode
}

export function resolveNodeAtWidth(
  document: CanvasDocument,
  node: CanvasNode,
  width: number,
): CanvasNode {
  const breakpoints = [...document.breakpoints]
    .sort((left, right) => left.minWidth - right.minWidth)
    .filter((breakpoint) => breakpoint.minWidth <= width)
  let resolved = node
  for (const breakpoint of breakpoints) {
    const patch = node.responsive[breakpoint.id]
    if (!patch) continue
    resolved = applyNodePatch(resolved, patch)
  }
  return resolved
}

function applyInstanceToNode(
  document: CanvasDocument,
  source: CanvasNode,
  instance: InstanceNode,
) {
  const component = document.nodes[instance.componentId]
  const variant =
    instance.variant ??
    (component?.type === 'component'
      ? component.defaultVariant
      : undefined)
  const variantPatch =
    component?.type === 'component' && variant
      ? component.variantOverrides[variant]?.[source.id]
      : undefined
  return applyNodePatch(
    applyNodePatch(source, variantPatch),
    instance.overrides[source.id],
  )
}

export function resolveNodeRef(
  document: CanvasDocument,
  ref: NodeRef,
  width = 1_440,
): CanvasNode | null {
  const source = document.nodes[ref.nodeId]
  if (!source) return null
  let activeInstance: InstanceNode | null = null
  for (const instanceId of ref.instancePath) {
    const instanceSource = document.nodes[instanceId]
    if (!instanceSource || instanceSource.type !== 'instance') return null
    const resolved = resolveNodeAtWidth(document, instanceSource, width)
    const resolvedInstance: CanvasNode = activeInstance
      ? applyInstanceToNode(document, resolved, activeInstance)
      : resolved
    if (resolvedInstance.type !== 'instance') return null
    activeInstance = resolvedInstance
  }
  const responsive = resolveNodeAtWidth(document, source, width)
  return activeInstance
    ? applyInstanceToNode(document, responsive, activeInstance)
    : responsive
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function safeDictionaryId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-zA-Z0-9_-]{1,200}$/.test(value)
  )
}

function validLength(length: unknown): length is CanvasLength {
  if (!isRecord(length) || typeof length.unit !== 'string') return false
  return (
    (length.unit === 'fill' || length.unit === 'hug') ||
    ((length.unit === 'px' || length.unit === 'percent') && finite(length.value))
  )
}

function validUrl(url: string) {
  if (url.startsWith('/api/asset/')) return true
  if (/^data:image\/(?:png|jpeg|webp|gif|avif);base64,/i.test(url)) return true
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' &&
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'))
    )
  } catch {
    return false
  }
}

function serializableData(
  value: unknown,
  active = new Set<unknown>(),
): boolean {
  if (value === undefined) return false
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true
  }
  if (typeof value === 'number') return finite(value)
  if (typeof value !== 'object' || active.has(value)) return false
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false
  }
  active.add(value)
  const serializable = Object.entries(value).every(([key, item]) =>
    Array.isArray(value)
      ? serializableData(item, active)
      : typeof key === 'string' && serializableData(item, active),
  )
  active.delete(value)
  return serializable
}

function safeCssText(value: unknown, max = 200): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max &&
    !/[{};<>\u0000-\u001f\u007f\\]/.test(value)
  )
}

function validColor(
  value: unknown,
  document: CanvasDocument,
): value is CanvasColor {
  if (isRecord(value)) {
    return (
      typeof value.token === 'string' &&
      Object.keys(value).length === 1 &&
      !!document.tokens[value.token]
    )
  }
  if (typeof value !== 'string' || value.length > 200) return false
  return (
    /^#[0-9a-f]{3,8}$/i.test(value) ||
    // Named + hyphenated system colors (CanvasText, -webkit-focus-ring-color).
    /^-?[a-z]+(?:-[a-z0-9]+)*$/i.test(value) ||
    /^(?:rgb|rgba|hsl|hsla|oklab|oklch|lab|lch)\([0-9a-z.%+,\s/-]+\)$/i.test(
      value,
    ) ||
    // Paper / modern browsers emit color(srgb …) and color-mix(…).
    /^color\([0-9a-z.%+,\s/()-]+\)$/i.test(value) ||
    /^color-mix\([0-9a-z.%+,\s/()#-]+\)$/i.test(value)
  )
}

function validGradientStops(
  stops: unknown,
  document: CanvasDocument,
) {
  return (
    Array.isArray(stops) &&
    stops.length > 0 &&
    stops.length <= 64 &&
    stops.every(
      (stop) =>
        isRecord(stop) &&
        finite(stop.offset) &&
        stop.offset >= 0 &&
        stop.offset <= 1 &&
        validColor(stop.color, document),
    )
  )
}

function validPaint(value: unknown, document: CanvasDocument) {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (value.type === 'solid') {
    return (
      Object.keys(value).every((key) => key === 'type' || key === 'color') &&
      validColor(value.color, document)
    )
  }
  if (value.type === 'linear-gradient') {
    return finite(value.angle) && validGradientStops(value.stops, document)
  }
  return (
    value.type === 'radial-gradient' &&
    finite(value.cx) &&
    finite(value.cy) &&
    value.cx >= 0 &&
    value.cx <= 1 &&
    value.cy >= 0 &&
    value.cy <= 1 &&
    (value.size === undefined ||
      (typeof value.size === 'string' &&
        value.size.length > 0 &&
        value.size.length <= 100 &&
        safeCssText(value.size, 100))) &&
    validGradientStops(value.stops, document)
  )
}

const layoutKeys = new Set([
  'position',
  'x',
  'y',
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'aspectRatio',
  'mode',
  'direction',
  'wrap',
  'gap',
  'padding',
  'align',
  'justify',
  'columns',
  'alignSelf',
  'grow',
  'shrink',
])

function validLayoutPatch(value: unknown, partial = true) {
  if (!isRecord(value)) return false
  if (Object.keys(value).some((key) => !layoutKeys.has(key))) return false
  if (
    (!partial || value.position !== undefined) &&
    !['flow', 'absolute'].includes(String(value.position))
  ) {
    return false
  }
  if (
    (!partial || value.mode !== undefined) &&
    !['absolute', 'flex', 'grid'].includes(String(value.mode))
  ) {
    return false
  }
  if (
    (!partial || value.width !== undefined) &&
    !validLength(value.width)
  ) {
    return false
  }
  if (
    (!partial || value.height !== undefined) &&
    !validLength(value.height)
  ) {
    return false
  }
  const numbers = [
    'x',
    'y',
    'minWidth',
    'maxWidth',
    'minHeight',
    'maxHeight',
    'aspectRatio',
    'gap',
    'columns',
    'grow',
    'shrink',
  ] as const
  if (
    !partial &&
    (value.x === undefined || value.y === undefined)
  ) {
    return false
  }
  if (
    numbers.some(
      (key) => value[key] !== undefined && !finite(value[key]),
    )
  ) {
    return false
  }
  if (
    value.direction !== undefined &&
    !['row', 'column'].includes(String(value.direction))
  ) {
    return false
  }
  if (value.wrap !== undefined && typeof value.wrap !== 'boolean') return false
  if (
    value.align !== undefined &&
    !['start', 'center', 'end', 'stretch'].includes(String(value.align))
  ) {
    return false
  }
  if (
    value.alignSelf !== undefined &&
    !['start', 'center', 'end', 'stretch'].includes(String(value.alignSelf))
  ) {
    return false
  }
  if (
    value.justify !== undefined &&
    !['start', 'center', 'end', 'space-between', 'space-around'].includes(
      String(value.justify),
    )
  ) {
    return false
  }
  if (
    value.padding !== undefined &&
    (!isRecord(value.padding) ||
      !['top', 'right', 'bottom', 'left'].every((key) =>
        finite((value.padding as Record<string, unknown>)[key]),
      ))
  ) {
    return false
  }
  return true
}

const styleKeys = new Set([
  'fills',
  'stroke',
  'radius',
  'shadows',
  'opacity',
  'overflow',
  'blendMode',
  'typography',
])

const blendModes = new Set([
  'normal',
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
])

function validTypography(value: unknown, partial = false) {
  if (!isRecord(value)) return false
  const allowed = new Set([
    'family',
    'size',
    'weight',
    'lineHeight',
    'letterSpacing',
    'align',
    'wrap',
    'decoration',
    'transform',
  ])
  if (Object.keys(value).some((key) => !allowed.has(key))) return false
  if (
    (!partial || value.family !== undefined) &&
    !safeCssText(value.family)
  ) {
    return false
  }
  for (const key of ['size', 'weight', 'lineHeight', 'letterSpacing'] as const) {
    if ((!partial || value[key] !== undefined) && !finite(value[key])) {
      return false
    }
  }
  if (
    (!partial || value.align !== undefined) &&
    !['left', 'center', 'right', 'justify'].includes(String(value.align))
  ) {
    return false
  }
  if (value.wrap !== undefined && typeof value.wrap !== 'boolean') return false
  if (
    value.decoration !== undefined &&
    !['none', 'underline', 'line-through'].includes(String(value.decoration))
  ) {
    return false
  }
  if (
    value.transform !== undefined &&
    !['none', 'uppercase', 'lowercase', 'capitalize'].includes(
      String(value.transform),
    )
  ) {
    return false
  }
  return true
}

function validStylePatch(
  value: unknown,
  document: CanvasDocument,
  partial = true,
) {
  return stylePatchFailure(value, document, partial) === null
}

function stylePatchFailure(
  value: unknown,
  document: CanvasDocument,
  partial = true,
): string | null {
  if (!isRecord(value)) return 'Style must be an object'
  const unknown = Object.keys(value).filter((key) => !styleKeys.has(key))
  if (unknown.length > 0) {
    return `Unknown style fields: ${unknown.slice(0, 5).join(', ')}`
  }
  if (
    (!partial || value.fills !== undefined) &&
    (!Array.isArray(value.fills) ||
      value.fills.length > 16 ||
      !value.fills.every((fill) => validPaint(fill, document)))
  ) {
    return 'Style fills are invalid'
  }
  if (
    value.stroke !== undefined &&
    (!isRecord(value.stroke) ||
      !validColor(value.stroke.color, document) ||
      !finite(value.stroke.width) ||
      (value.stroke.style !== undefined &&
        !['solid', 'dashed', 'dotted'].includes(String(value.stroke.style))))
  ) {
    return 'Style stroke is invalid'
  }
  if (
    (!partial || value.radius !== undefined) &&
    !(
      finite(value.radius) ||
      (Array.isArray(value.radius) &&
        value.radius.length === 4 &&
        value.radius.every(finite))
    )
  ) {
    return 'Style radius is invalid'
  }
  if (
    (!partial || value.shadows !== undefined) &&
    (!Array.isArray(value.shadows) ||
      value.shadows.length > 16 ||
      !value.shadows.every(
        (shadow) =>
          isRecord(shadow) &&
          ['x', 'y', 'blur', 'spread'].every((key) => finite(shadow[key])) &&
          validColor(shadow.color, document) &&
          (shadow.inset === undefined || typeof shadow.inset === 'boolean'),
      ))
  ) {
    return 'Style shadows are invalid'
  }
  if (
    (!partial || value.opacity !== undefined) &&
    (!finite(value.opacity) || value.opacity < 0 || value.opacity > 1)
  ) {
    return 'Style opacity is invalid'
  }
  if (
    (!partial || value.overflow !== undefined) &&
    !['visible', 'hidden', 'auto'].includes(String(value.overflow))
  ) {
    return 'Style overflow is invalid'
  }
  if (
    value.blendMode !== undefined &&
    (typeof value.blendMode !== 'string' || !blendModes.has(value.blendMode))
  ) {
    return 'Style blend mode is invalid'
  }
  if (
    value.typography !== undefined &&
    !validTypography(value.typography, partial)
  ) {
    return 'Style typography is invalid'
  }
  return null
}

function validStateValue(
  value: unknown,
  type?: CanvasStateDefinition['type'],
): value is CanvasStateValue {
  if (typeof value === 'string') {
    return (!type || type === 'string') && value.length <= 10_000
  }
  if (typeof value === 'number') {
    return (!type || type === 'number') && finite(value)
  }
  return typeof value === 'boolean' && (!type || type === 'boolean')
}

function validStateDefinitions(
  value: unknown,
): value is Record<StateId, CanvasStateDefinition> {
  return (
    isRecord(value) &&
    Object.keys(value).length <= 100 &&
    Object.entries(value).every(
      ([id, definition]) =>
        safeDictionaryId(id) &&
        isRecord(definition) &&
        Object.keys(definition).every((key) =>
          ['id', 'name', 'type', 'initial'].includes(key),
        ) &&
        definition.id === id &&
        typeof definition.name === 'string' &&
        definition.name.length > 0 &&
        definition.name.length <= 200 &&
        ['string', 'number', 'boolean'].includes(String(definition.type)) &&
        validStateValue(
          definition.initial,
          definition.type as CanvasStateDefinition['type'],
        ),
    )
  )
}

function validVisualStates(value: unknown, document: CanvasDocument) {
  if (!isRecord(value)) return false
  const names = Object.keys(value)
  if (names.length === 0 || names.length > VISUAL_STATES.length) return false
  return names.every((name) => {
    if (!(VISUAL_STATES as readonly string[]).includes(name)) return false
    const state = value[name]
    if (!isRecord(state)) return false
    if (Object.keys(state).some((key) => !['style', 'transform'].includes(key))) {
      return false
    }
    if (state.style !== undefined && !validStylePatch(state.style, document)) {
      return false
    }
    if (state.transform !== undefined && !isCanvasMotionTransform(state.transform)) {
      return false
    }
    return state.style !== undefined || state.transform !== undefined
  })
}

/**
 * A node may only play animations the document defines, so a reference cannot
 * outlive what it points at.
 */
function validNodeAnimations(value: unknown, document: CanvasDocument) {
  if (!Array.isArray(value) || value.length > MAX_NODE_ANIMATIONS) return false
  const defined = document.animations ?? {}
  return value.every(
    (use) => isCanvasNodeAnimation(use) && defined[use.animationId] !== undefined,
  )
}

const interactionTriggers = new Set<CanvasEventTrigger>([
  'click',
  'double-click',
  'hover',
  'hover-end',
  'submit',
  'change',
  'input',
  'focus',
  'blur',
  'state-change',
])

function validInteractions(
  value: unknown,
  document: CanvasDocument,
  states?: Record<StateId, CanvasStateDefinition>,
) {
  if (!Array.isArray(value) || value.length > 100) return false
  return value.every((interaction) => {
    if (
      !isRecord(interaction) ||
      !interactionTriggers.has(interaction.trigger as CanvasEventTrigger) ||
      !Array.isArray(interaction.actions) ||
      interaction.actions.length > 100
    ) {
      return false
    }
    const stateChange = interaction.trigger === 'state-change'
    if (
      (stateChange &&
        (!safeDictionaryId(interaction.stateId) ||
          (states && !states[interaction.stateId]))) ||
      (!stateChange && interaction.stateId !== undefined)
    ) {
      return false
    }
    if (
      interaction.when !== undefined &&
      (!Array.isArray(interaction.when) ||
        interaction.when.length > 20 ||
        interaction.when.some(
          (condition) =>
            !isRecord(condition) ||
            !safeDictionaryId(condition.stateId) ||
            (states && !states[condition.stateId]) ||
            !['equals', 'not-equals'].includes(String(condition.operator)) ||
            !validStateValue(
              condition.value,
              states?.[condition.stateId]?.type,
            ),
        ))
    ) {
      return false
    }
    return interaction.actions.every((action) => {
      if (!isRecord(action) || typeof action.type !== 'string') return false
      if (
        action.type === 'set-state' ||
        action.type === 'toggle-state' ||
        action.type === 'increment-state'
      ) {
        if (
          !safeDictionaryId(action.stateId) ||
          (states && !states[action.stateId])
        ) {
          return false
        }
        const definition = states?.[action.stateId]
        if (action.type === 'set-state') {
          return validStateValue(action.value, definition?.type)
        }
        if (action.type === 'toggle-state') {
          return !definition || definition.type === 'boolean'
        }
        return (
          (!definition || definition.type === 'number') &&
          finite(action.amount)
        )
      }
      if (action.type === 'open-url') {
        return (
          typeof action.url === 'string' &&
          validUrl(action.url) &&
          (action.target === undefined ||
            action.target === '_self' ||
            action.target === '_blank')
        )
      }
      if (action.type === 'navigate' || action.type === 'open-overlay') {
        return (
          typeof action.pageId === 'string' &&
          document.nodes[action.pageId]?.type === 'page'
        )
      }
      if (action.type === 'visibility') {
        return (
          typeof action.nodeId === 'string' &&
          !!document.nodes[action.nodeId] &&
          ['show', 'hide', 'toggle'].includes(String(action.value))
        )
      }
      if (action.type === 'close-overlay') return true
      if (action.type === 'set-theme') {
        return (
          safeDictionaryId(action.themeId) &&
          !!document.themes[action.themeId]
        )
      }
      return (
        action.type === 'set-variant' &&
        typeof action.instanceId === 'string' &&
        document.nodes[action.instanceId]?.type === 'instance' &&
        typeof action.variant === 'string' &&
        action.variant.length <= 200 &&
        (() => {
          const instance = document.nodes[action.instanceId] as InstanceNode
          const component = document.nodes[instance.componentId]
          return (
            component?.type === 'component' &&
            component.variants.includes(action.variant as string)
          )
        })()
      )
    })
  })
}

function validTextRun(
  value: unknown,
  document: CanvasDocument,
): value is TextRun {
  return (
    isRecord(value) &&
    typeof value.start === 'number' &&
    Number.isInteger(value.start) &&
    typeof value.end === 'number' &&
    Number.isInteger(value.end) &&
    value.start >= 0 &&
    value.end >= value.start &&
    (value.typography === undefined ||
      validTypography(value.typography, true)) &&
    (value.color === undefined || validColor(value.color, document))
  )
}

const patchKeys = new Set([
  'name',
  'hidden',
  'locked',
  'rotation',
  'layout',
  'style',
  'semanticTag',
  'text',
  'runs',
  'src',
  'alt',
  'interactions',
  'variant',
  'visualStates',
  'transition',
  'animations',
])

function validNodePatch(
  value: unknown,
  document: CanvasDocument,
  states?: Record<StateId, CanvasStateDefinition>,
) {
  if (!isRecord(value) || Object.keys(value).some((key) => !patchKeys.has(key))) {
    return false
  }
  if (
    value.name !== undefined &&
    (typeof value.name !== 'string' ||
      value.name.length === 0 ||
      value.name.length > 200)
  ) {
    return false
  }
  if (
    ['hidden', 'locked'].some(
      (key) => value[key] !== undefined && typeof value[key] !== 'boolean',
    )
  ) {
    return false
  }
  if (value.rotation !== undefined && !finite(value.rotation)) return false
  if (value.layout !== undefined && !validLayoutPatch(value.layout)) return false
  if (value.style !== undefined && !validStylePatch(value.style, document)) {
    return false
  }
  if (
    value.semanticTag !== undefined &&
    ![
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
    ].includes(String(value.semanticTag))
  ) {
    return false
  }
  if (
    value.text !== undefined &&
    (typeof value.text !== 'string' || value.text.length > 1_000_000)
  ) {
    return false
  }
  if (
    value.runs !== undefined &&
    (!Array.isArray(value.runs) ||
      value.runs.length > 10_000 ||
      !value.runs.every((run) => validTextRun(run, document)))
  ) {
    return false
  }
  if (value.src !== undefined && (typeof value.src !== 'string' || !validUrl(value.src))) {
    return false
  }
  if (
    value.alt !== undefined &&
    (typeof value.alt !== 'string' || value.alt.length > 1_000)
  ) {
    return false
  }
  if (
    value.interactions !== undefined &&
    !validInteractions(value.interactions, document, states)
  ) {
    return false
  }
  if (value.visualStates !== undefined && !validVisualStates(value.visualStates, document)) {
    return false
  }
  if (value.transition !== undefined && !isCanvasTransition(value.transition)) {
    return false
  }
  if (value.animations !== undefined && !validNodeAnimations(value.animations, document)) {
    return false
  }
  return !(
    value.variant !== undefined &&
    (typeof value.variant !== 'string' || value.variant.length > 200)
  )
}

const fastMutationKeys = new Set([
  'name',
  'hidden',
  'locked',
  'rotation',
  'layout',
  'style',
  'responsive',
  'interactions',
  'visualStates',
  'transition',
  'animations',
  'metadata',
  'order',
])

/**
 * `nodeId` scopes interaction validation to the state definitions that node can
 * actually see. Without it a patch may declare an action against a state that
 * does not exist, and the caller skipping full validation would keep it.
 *
 * `replace` names the fields the caller will write whole rather than merge.
 * Those have to hold up as complete values, because nothing of the node's own
 * layout or style survives underneath them.
 */
export function validateCommonNodeMutationPatch(
  document: CanvasDocument,
  value: unknown,
  nodeId?: NodeId,
  replace: readonly string[] = [],
) {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !fastMutationKeys.has(key))
  ) {
    return false
  }
  if (replace.some((key) => !fastMutationKeys.has(key))) return false
  const replaced = new Set(replace)
  if (
    (replaced.has('layout') &&
      !validLayoutPatch(value.layout, false)) ||
    (replaced.has('style') &&
      !validStylePatch(value.style, document, false))
  ) {
    return false
  }
  const {
    responsive,
    metadata,
    order,
    ...nodePatch
  } = value
  const states =
    nodeId === undefined
      ? undefined
      : stateDefinitionsForNode(document, nodeId)
  if (!validNodePatch(nodePatch, document, states)) return false
  if (order !== undefined && !finite(order)) return false
  if (
    metadata !== undefined &&
    (!isRecord(metadata) ||
      !serializableData(metadata) ||
      JSON.stringify(metadata).length > 100_000)
  ) {
    return false
  }
  if (responsive !== undefined) {
    if (!isRecord(responsive)) return false
    const breakpointIds = new Set(
      document.breakpoints.map((breakpoint) => breakpoint.id),
    )
    if (
      Object.entries(responsive).some(
        ([breakpointId, patch]) =>
          !breakpointIds.has(breakpointId) ||
          !validNodePatch(patch, document, states),
      )
    ) {
      return false
    }
  }
  return true
}

function validVectorPath(value: string) {
  return (
    value.length <= 100_000 &&
    /^[MmZzLlHhVvCcSsQqTtAaEe0-9+\-.,\s]*$/.test(value)
  )
}

function pushIssue(
  issues: DocumentValidationIssue[],
  path: string,
  message: string,
) {
  issues.push({ path, message })
}

export function validateDocument(value: unknown): DocumentValidationResult {
  const issues: DocumentValidationIssue[] = []
  if (!isRecord(value)) {
    pushIssue(issues, '', 'Canvas document must be an object')
    return { ok: false, issues }
  }
  if (!serializableData(value)) {
    pushIssue(issues, '', 'Canvas document must be finite and serializable')
    return { ok: false, issues }
  }
  if (JSON.stringify(value).length > 25_000_000) {
    pushIssue(issues, '', 'Canvas document exceeds the 25 MB limit')
    return { ok: false, issues }
  }
  if (value.schemaVersion !== CANVAS_SCHEMA_VERSION) {
    pushIssue(issues, 'schemaVersion', `Expected Canvas schema ${CANVAS_SCHEMA_VERSION}`)
    return { ok: false, issues }
  }
  if (
    Object.keys(value).some(
      (key) =>
        ![
          'schemaVersion',
          'id',
          'name',
          'nodes',
          'breakpoints',
          'tokens',
          'themes',
          'activeThemeId',
          'animations',
          'metadata',
        ].includes(key),
    )
  ) {
    pushIssue(issues, '', 'Canvas document contains unknown fields')
  }
  if (
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    value.id.length > 200 ||
    typeof value.name !== 'string' ||
    value.name.length === 0 ||
    value.name.length > 200
  ) {
    pushIssue(issues, '', 'Document id and name must be strings')
  }
  if (!isRecord(value.nodes)) {
    pushIssue(issues, 'nodes', 'Nodes must be a normalized object')
    return { ok: false, issues }
  }
  if (!Array.isArray(value.breakpoints)) {
    pushIssue(issues, 'breakpoints', 'Breakpoints must be an array')
    return { ok: false, issues }
  }
  if (!isRecord(value.tokens)) {
    pushIssue(issues, 'tokens', 'Tokens must be an object')
    return { ok: false, issues }
  }
  if (!isRecord(value.themes) || typeof value.activeThemeId !== 'string') {
    pushIssue(issues, 'themes', 'Themes and the active theme are required')
    return { ok: false, issues }
  }
  if (!value.themes[value.activeThemeId]) {
    pushIssue(issues, 'activeThemeId', 'Active theme does not exist')
  }
  if (value.animations !== undefined) {
    if (!isRecord(value.animations)) {
      pushIssue(issues, 'animations', 'Animations must be an object')
    } else if (Object.keys(value.animations).length > MAX_ANIMATIONS) {
      pushIssue(issues, 'animations', `A document holds at most ${MAX_ANIMATIONS} animations`)
    } else {
      for (const [id, animation] of Object.entries(value.animations)) {
        if (!isCanvasAnimation(animation) || animation.id !== id) {
          pushIssue(issues, `animations.${id}`, 'Animation is invalid')
        }
      }
    }
  }
  if (!isRecord(value.metadata)) {
    pushIssue(issues, 'metadata', 'Metadata must be an object')
  } else if (
    !finite(value.metadata.createdAt) ||
    !finite(value.metadata.updatedAt)
  ) {
    pushIssue(issues, 'metadata', 'Document timestamps must be finite')
  } else if (
    Object.keys(value.metadata).some(
      (key) =>
        ![
          'createdAt',
          'updatedAt',
          'migratedFrom',
          'migrationWarnings',
        ].includes(key),
    ) ||
    (value.metadata.migratedFrom !== undefined &&
      !finite(value.metadata.migratedFrom)) ||
    (value.metadata.migrationWarnings !== undefined &&
      (!Array.isArray(value.metadata.migrationWarnings) ||
        value.metadata.migrationWarnings.length > 10_000 ||
        value.metadata.migrationWarnings.some(
          (warning) =>
            typeof warning !== 'string' || warning.length > 10_000,
        )))
  ) {
    pushIssue(issues, 'metadata', 'Document metadata is invalid')
  }

  const document = value as unknown as CanvasDocument
  const entries = Object.entries(document.nodes)
  if (entries.length > MAX_CANVAS_NODES) {
    pushIssue(issues, 'nodes', `Canvas has more than ${MAX_CANVAS_NODES} nodes`)
  }
  const breakpointIds = new Set<string>()
  for (const [index, breakpoint] of document.breakpoints.entries()) {
    if (!isRecord(breakpoint)) {
      pushIssue(issues, `breakpoints.${index}`, 'Breakpoint must be an object')
      continue
    }
    if (
      !safeDictionaryId(breakpoint.id) ||
      breakpointIds.has(breakpoint.id)
    ) {
      pushIssue(issues, `breakpoints.${index}.id`, 'Breakpoint ids must be unique and non-empty')
      continue
    }
    breakpointIds.add(breakpoint.id)
    if (
      Object.keys(breakpoint).some(
        (key) =>
          !['id', 'name', 'minWidth', 'previewWidth'].includes(key),
      ) ||
      typeof breakpoint.name !== 'string' ||
      breakpoint.name.length === 0 ||
      breakpoint.name.length > 200 ||
      !finite(breakpoint.minWidth) ||
      breakpoint.minWidth < 0 ||
      !finite(breakpoint.previewWidth) ||
      breakpoint.previewWidth <= 0
    ) {
      pushIssue(issues, `breakpoints.${index}`, 'Breakpoint widths must be finite')
    }
  }
  for (const [id, token] of Object.entries(document.tokens)) {
    if (
      !isRecord(token) ||
      !safeDictionaryId(id) ||
      token.id !== id ||
      Object.keys(token).some(
        (key) => !['id', 'name', 'type', 'value', 'modes'].includes(key),
      ) ||
      typeof token.name !== 'string' ||
      token.name.length === 0 ||
      token.name.length > 200 ||
      !['color', 'number', 'font'].includes(String(token.type))
    ) {
      pushIssue(issues, `tokens.${id}`, 'Token is malformed')
      continue
    }
    if (
      (token.type === 'number' && !finite(token.value)) ||
      (token.type === 'font' && !safeCssText(token.value)) ||
      (token.type === 'color' && !validColor(token.value, document))
    ) {
      pushIssue(issues, `tokens.${id}.value`, 'Token value is invalid')
    }
    if (
      token.modes !== undefined &&
      (!isRecord(token.modes) ||
        Object.entries(token.modes).some(([themeId, mode]) =>
          !document.themes[themeId] ||
          (token.type === 'number'
            ? !finite(mode)
            : token.type === 'font'
              ? !safeCssText(mode)
              : !validColor(mode, document)),
        ))
    ) {
      pushIssue(issues, `tokens.${id}.modes`, 'Token modes are invalid')
    }
  }
  for (const [id, theme] of Object.entries(document.themes)) {
    if (
      !isRecord(theme) ||
      !safeDictionaryId(id) ||
      theme.id !== id ||
      Object.keys(theme).some((key) => !['id', 'name'].includes(key)) ||
      typeof theme.name !== 'string' ||
      theme.name.length === 0 ||
      theme.name.length > 200
    ) {
      pushIssue(issues, `themes.${id}`, 'Theme is malformed')
    }
  }

  const nodeTypes = new Set<CanvasNodeType>([
    'page',
    'component',
    'frame',
    'group',
    'text',
    'shape',
    'vector',
    'image',
    'instance',
  ])
  const commonNodeKeys = [
    'id',
    'type',
    'name',
    'parentId',
    'order',
    'hidden',
    'locked',
    'rotation',
    'layout',
    'style',
    'responsive',
    'interactions',
    'visualStates',
    'transition',
    'animations',
    'metadata',
  ]
  const specificNodeKeys: Record<CanvasNodeType, string[]> = {
    page: ['states', 'viewport'],
    component: ['states', 'variants', 'defaultVariant', 'variantOverrides'],
    frame: ['semanticTag'],
    group: [],
    text: ['text', 'runs'],
    shape: ['shape'],
    vector: ['viewBox', 'paths'],
    image: ['src', 'alt', 'fit'],
    instance: ['componentId', 'variant', 'overrides'],
  }
  const containerTypes = new Set<CanvasNodeType>(['page', 'component', 'frame', 'group'])
  const childrenByParent = new Map<NodeId | null, NodeId[]>()
  for (const [id, node] of entries) {
    if (!isRecord(node) || (node.parentId !== null && typeof node.parentId !== 'string')) continue
    const children = childrenByParent.get(node.parentId) ?? []
    children.push(id)
    childrenByParent.set(node.parentId, children)
  }

  // Resolve hierarchy validity once for the whole normalized graph. Walking
  // every node's parent chain independently made a deep, otherwise valid tree
  // quadratic. `reachesCycle` also preserves the old result for descendants of
  // a cycle: their ancestor walk would eventually have found the same cycle.
  const reachesHierarchyCycle = new Map<NodeId, boolean>()
  for (const [id] of entries) {
    if (reachesHierarchyCycle.has(id)) continue
    const path: NodeId[] = []
    const pathIndexes = new Map<NodeId, number>()
    let current: NodeId | null = id
    while (
      current !== null &&
      document.nodes[current] !== undefined &&
      !reachesHierarchyCycle.has(current) &&
      !pathIndexes.has(current)
    ) {
      pathIndexes.set(current, path.length)
      path.push(current)
      const parentId: NodeId | null | undefined =
        document.nodes[current]?.parentId
      current = typeof parentId === 'string' ? parentId : null
    }
    const reachesCycle =
      current !== null &&
      (pathIndexes.has(current) || reachesHierarchyCycle.get(current) === true)
    for (const pathId of path) reachesHierarchyCycle.set(pathId, reachesCycle)
  }

  // State definitions belong to the nearest Page or Component root. Cache the
  // root for every node with parent-path compression so interaction validation
  // stays linear on deeply nested documents.
  const stateRootByNode = new Map<NodeId, NodeId | null>()
  for (const [id] of entries) {
    if (stateRootByNode.has(id)) continue
    const path: NodeId[] = []
    const seen = new Set<NodeId>()
    let current: NodeId | null = id
    let rootId: NodeId | null = null
    while (current !== null && !seen.has(current)) {
      if (stateRootByNode.has(current)) {
        rootId = stateRootByNode.get(current) ?? null
        break
      }
      seen.add(current)
      const node: CanvasNode | undefined = document.nodes[current]
      if (!node) break
      if (node.type === 'page' || node.type === 'component') {
        rootId = node.id
        stateRootByNode.set(node.id, node.id)
        break
      }
      path.push(current)
      current = typeof node.parentId === 'string' ? node.parentId : null
    }
    for (const pathId of path) stateRootByNode.set(pathId, rootId)
  }

  const componentDescendants = new Map<NodeId, Set<NodeId>>()
  const descendantsOf = (componentId: NodeId) => {
    const cached = componentDescendants.get(componentId)
    if (cached) return cached
    const descendants = new Set<NodeId>()
    const queue = [componentId]
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index]!
      for (const childId of childrenByParent.get(current) ?? []) {
        descendants.add(childId)
        queue.push(childId)
      }
    }
    componentDescendants.set(componentId, descendants)
    return descendants
  }
  for (const [id, rawNode] of entries) {
    const path = `nodes.${id}`
    if (!isRecord(rawNode)) {
      pushIssue(issues, path, 'Node must be an object')
      continue
    }
    if (typeof rawNode.type !== 'string' || !nodeTypes.has(rawNode.type as CanvasNodeType)) {
      pushIssue(issues, `${path}.type`, 'Unknown node type')
      continue
    }
    const node = rawNode as unknown as CanvasNode
    const allowedNodeKeys = new Set([
      ...commonNodeKeys,
      ...specificNodeKeys[node.type],
    ])
    if (Object.keys(rawNode).some((key) => !allowedNodeKeys.has(key))) {
      pushIssue(issues, path, 'Node contains unknown fields')
    }
    if (node.id !== id) pushIssue(issues, `${path}.id`, 'Node key and id differ')
    if (typeof node.name !== 'string' || !node.name || node.name.length > 200) {
      pushIssue(issues, `${path}.name`, 'Node name is invalid')
    }
    if (!finite(node.order) || !finite(node.rotation)) pushIssue(issues, path, 'Order and rotation must be finite')
    if (typeof node.hidden !== 'boolean' || typeof node.locked !== 'boolean') {
      pushIssue(issues, path, 'Visibility and lock state must be booleans')
    }
    if (node.parentId !== null && typeof node.parentId !== 'string') {
      pushIssue(issues, `${path}.parentId`, 'Parent id must be a string or null')
    } else if (node.parentId !== null && !document.nodes[node.parentId]) {
      pushIssue(issues, `${path}.parentId`, 'Parent does not exist')
    }
    if ((node.type === 'page' || node.type === 'component') && node.parentId !== null) {
      pushIssue(issues, `${path}.parentId`, `${node.type} nodes must be document roots`)
    }
    if (node.type !== 'page' && node.type !== 'component' && node.parentId === null) {
      pushIssue(issues, `${path}.parentId`, `${node.type} nodes must have a parent`)
    }
    if (node.parentId) {
      const parent = document.nodes[node.parentId]
      if (parent && !containerTypes.has(parent.type)) {
        pushIssue(issues, `${path}.parentId`, `${parent.type} nodes cannot contain children`)
      }
    }
    if (!isRecord(node.layout)) {
      pushIssue(issues, `${path}.layout`, 'Layout must be an object')
      continue
    }
    if (!validLayoutPatch(node.layout, false)) {
      pushIssue(issues, `${path}.layout`, 'Layout contains invalid fields')
    }
    if (!validLength(node.layout.width) || !validLength(node.layout.height)) {
      pushIssue(issues, `${path}.layout`, 'Width and height must be valid lengths')
    }
    if (
      !['flow', 'absolute'].includes(node.layout.position) ||
      !['absolute', 'flex', 'grid'].includes(node.layout.mode)
    ) {
      pushIssue(issues, `${path}.layout`, 'Layout mode is invalid')
    }
    const layoutNumbers = [
      node.layout.x,
      node.layout.y,
      node.layout.minWidth,
      node.layout.maxWidth,
      node.layout.minHeight,
      node.layout.maxHeight,
      node.layout.aspectRatio,
      node.layout.gap,
      node.layout.columns,
    ].filter((number) => number !== undefined)
    if (!layoutNumbers.every(finite)) {
      pushIssue(issues, `${path}.layout`, 'Layout values must be finite')
    }
    if (node.layout.padding && !Object.values(node.layout.padding).every(finite)) {
      pushIssue(issues, `${path}.layout.padding`, 'Padding must be finite')
    }
    if (!isRecord(node.style)) {
      pushIssue(issues, `${path}.style`, 'Style must be an object')
      continue
    }
    const styleFailure = stylePatchFailure(node.style, document, false)
    if (styleFailure) {
      pushIssue(issues, `${path}.style`, styleFailure)
    }
    if (![node.layout.x, node.layout.y, node.style.opacity].every(finite)) {
      pushIssue(issues, path, 'Geometry and opacity must be finite')
    }
    if (node.style.opacity < 0 || node.style.opacity > 1) {
      pushIssue(issues, `${path}.style.opacity`, 'Opacity must be between zero and one')
    }
    if (!Array.isArray(node.style.fills) || !Array.isArray(node.style.shadows)) {
      pushIssue(issues, `${path}.style`, 'Fills and shadows must be arrays')
    }
    if (!isRecord(node.responsive)) {
      pushIssue(issues, `${path}.responsive`, 'Responsive overrides must be an object')
      continue
    }
    for (const [breakpointId, patch] of Object.entries(node.responsive)) {
      if (!breakpointIds.has(breakpointId)) {
        pushIssue(issues, `${path}.responsive.${breakpointId}`, 'Unknown breakpoint')
      }
      if (!isRecord(patch)) {
        pushIssue(issues, `${path}.responsive.${breakpointId}`, 'Responsive override must be an object')
      } else if (!validNodePatch(patch, document)) {
        pushIssue(
          issues,
          `${path}.responsive.${breakpointId}`,
          'Responsive override contains invalid fields',
        )
      }
    }
    if (node.type === 'instance') {
      const component = document.nodes[node.componentId]
      if (!component || component.type !== 'component') {
        pushIssue(issues, `${path}.componentId`, 'Instance component does not exist')
      }
      if (!isRecord(node.overrides)) {
        pushIssue(issues, `${path}.overrides`, 'Instance overrides must be an object')
      } else if (component?.type === 'component') {
        const descendants = descendantsOf(component.id)
        for (const targetId of Object.keys(node.overrides)) {
          if (targetId !== component.id && !descendants.has(targetId)) {
            pushIssue(issues, `${path}.overrides.${targetId}`, 'Override target is outside the component')
          }
          if (!validNodePatch(node.overrides[targetId], document)) {
            pushIssue(
              issues,
              `${path}.overrides.${targetId}`,
              'Instance override contains invalid fields',
            )
          }
        }
      }
      if (
        node.variant !== undefined &&
        (component?.type !== 'component' ||
          !component.variants.includes(node.variant))
      ) {
        pushIssue(
          issues,
          `${path}.variant`,
          'Instance variant does not exist on its component',
        )
      }
    }
    if (
      (node.type === 'page' || node.type === 'component') &&
      node.states !== undefined &&
      !validStateDefinitions(node.states)
    ) {
      pushIssue(issues, `${path}.states`, 'State definitions are invalid')
    }
    if (node.type === 'image' && (typeof node.src !== 'string' || !validUrl(node.src))) {
      pushIssue(issues, `${path}.src`, 'Image URL is not allowed')
    }
    if (node.type === 'vector') {
      if (
        typeof node.viewBox !== 'string' ||
        !/^-?\d+(?:\.\d+)?(?:\s+-?\d+(?:\.\d+)?){3}$/.test(node.viewBox) ||
        !Array.isArray(node.paths) ||
        node.paths.some((vectorPath) => !isRecord(vectorPath) || typeof vectorPath.d !== 'string' || !validVectorPath(vectorPath.d))
      ) {
        pushIssue(issues, path, 'Vector data is unsafe or malformed')
      }
    }
    if (!Array.isArray(node.interactions)) {
      pushIssue(issues, `${path}.interactions`, 'Interactions must be an array')
      continue
    }
    if (
      !validInteractions(
        node.interactions,
        document,
        (() => {
          const rootId = stateRootByNode.get(node.id)
          const root = rootId ? document.nodes[rootId] : undefined
          return root?.type === 'page' || root?.type === 'component'
            ? root.states ?? {}
            : {}
        })(),
      )
    ) {
      pushIssue(issues, `${path}.interactions`, 'Interactions are invalid')
    }
    if (
      node.visualStates !== undefined &&
      !validVisualStates(node.visualStates, document)
    ) {
      pushIssue(issues, `${path}.visualStates`, 'Visual states are invalid')
    }
    if (node.transition !== undefined && !isCanvasTransition(node.transition)) {
      pushIssue(issues, `${path}.transition`, 'Transition is invalid')
    }
    if (
      node.animations !== undefined &&
      !validNodeAnimations(node.animations, document)
    ) {
      pushIssue(
        issues,
        `${path}.animations`,
        'Animations must reference animations this document defines',
      )
    }
    for (const interaction of node.interactions) {
      if (!isRecord(interaction) || !Array.isArray(interaction.actions)) {
        pushIssue(issues, `${path}.interactions`, 'Interaction is malformed')
        continue
      }
      for (const action of interaction.actions) {
        if (!isRecord(action) || typeof action.type !== 'string') {
          pushIssue(issues, `${path}.interactions`, 'Action is malformed')
          continue
        }
        if (
          action.type === 'open-url' &&
          (typeof action.url !== 'string' || !validUrl(action.url))
        ) {
          pushIssue(issues, `${path}.interactions`, 'Interaction URL is not allowed')
        }
        if (
          (action.type === 'navigate' || action.type === 'open-overlay') &&
          (typeof action.pageId !== 'string' || document.nodes[action.pageId]?.type !== 'page')
        ) {
          pushIssue(issues, `${path}.interactions`, 'Interaction page does not exist')
        }
        if (
          action.type === 'visibility' &&
          (typeof action.nodeId !== 'string' || !document.nodes[action.nodeId])
        ) {
          pushIssue(issues, `${path}.interactions`, 'Interaction node does not exist')
        }
      }
    }
    if (
      node.metadata !== undefined &&
      (!isRecord(node.metadata) ||
        JSON.stringify(node.metadata).length > 100_000)
    ) {
      pushIssue(issues, `${path}.metadata`, 'Node metadata is invalid or too large')
    }
    if (node.type === 'page') {
      if (
        !isRecord(node.viewport) ||
        !finite(node.viewport.width) ||
        node.viewport.width <= 0 ||
        !finite(node.viewport.minHeight) ||
        node.viewport.minHeight <= 0
      ) {
        pushIssue(issues, `${path}.viewport`, 'Page viewport is invalid')
      }
    }
    if (node.type === 'component') {
      if (
        !Array.isArray(node.variants) ||
        node.variants.length === 0 ||
        node.variants.length > 100 ||
        new Set(node.variants).size !== node.variants.length ||
        node.variants.some(
          (variant) =>
            typeof variant !== 'string' ||
            variant.length === 0 ||
            variant.length > 200,
        ) ||
        (node.defaultVariant !== undefined &&
          !node.variants.includes(node.defaultVariant))
      ) {
        pushIssue(issues, `${path}.variants`, 'Component variants are invalid')
      }
      if (!isRecord(node.variantOverrides)) {
        pushIssue(
          issues,
          `${path}.variantOverrides`,
          'Component variant overrides must be an object',
        )
      } else {
        const descendants = descendantsOf(node.id)
        for (const [variant, overrides] of Object.entries(
          node.variantOverrides,
        )) {
          if (
            !node.variants.includes(variant) ||
            !isRecord(overrides) ||
            Object.entries(overrides).some(
              ([targetId, patch]) =>
                (targetId !== node.id && !descendants.has(targetId)) ||
                !validNodePatch(patch, document),
            )
          ) {
            pushIssue(
              issues,
              `${path}.variantOverrides.${variant}`,
              'Component variant overrides are invalid',
            )
          }
        }
      }
    }
    if (
      node.type === 'frame' &&
      ![
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
      ].includes(node.semanticTag)
    ) {
      pushIssue(issues, `${path}.semanticTag`, 'Semantic tag is invalid')
    }
    if (node.type === 'text') {
      if (
        typeof node.text !== 'string' ||
        node.text.length > 1_000_000 ||
        !Array.isArray(node.runs) ||
        node.runs.length > 10_000 ||
        node.runs.some(
          (run) =>
            !validTextRun(run, document) ||
            run.end > node.text.length,
        )
      ) {
        pushIssue(issues, path, 'Text content or runs are invalid')
      }
    }
    if (
      node.type === 'shape' &&
      !['rectangle', 'ellipse', 'line'].includes(node.shape)
    ) {
      pushIssue(issues, `${path}.shape`, 'Shape kind is invalid')
    }
    if (
      node.type === 'image' &&
      (typeof node.alt !== 'string' ||
        node.alt.length > 1_000 ||
        !['cover', 'contain', 'fill'].includes(node.fit))
    ) {
      pushIssue(issues, path, 'Image properties are invalid')
    }
    if (
      node.type === 'vector' &&
      Array.isArray(node.paths) &&
      node.paths.some(
        (vectorPath) =>
          (vectorPath.fill !== undefined &&
            !validColor(vectorPath.fill, document)) ||
          (vectorPath.stroke !== undefined &&
            !validColor(vectorPath.stroke, document)) ||
          (vectorPath.strokeWidth !== undefined &&
            !finite(vectorPath.strokeWidth)),
      )
    ) {
      pushIssue(issues, path, 'Vector paint is invalid')
    }
  }

  for (const [id] of entries) {
    if (reachesHierarchyCycle.get(id)) {
      pushIssue(issues, `nodes.${id}.parentId`, 'Node hierarchy contains a cycle')
    }
  }

  const componentEdges = new Map<NodeId, NodeId[]>()
  for (const node of Object.values(document.nodes)) {
    if (node.type === 'component') componentEdges.set(node.id, [])
  }
  for (const node of Object.values(document.nodes)) {
    if (node.type !== 'instance') continue
    const rootId = stateRootByNode.get(node.id)
    if (rootId && document.nodes[rootId]?.type === 'component') {
      componentEdges.get(rootId)?.push(node.componentId)
    }
  }

  // Determine which components can reach a recursive instance cycle with one
  // iterative DFS. The previous fresh recursive DFS per component repeated the
  // same graph work and could overflow the call stack on adversarial input.
  const componentVisitState = new Map<NodeId, 'active' | 'done'>()
  const reachesComponentCycle = new Map<NodeId, boolean>()
  for (const componentId of componentEdges.keys()) {
    if (componentVisitState.get(componentId) === 'done') continue
    const stack: Array<{
      id: NodeId
      edgeIndex: number
      reachesCycle: boolean
    }> = [{ id: componentId, edgeIndex: 0, reachesCycle: false }]
    componentVisitState.set(componentId, 'active')
    while (stack.length > 0) {
      const frame = stack.at(-1)!
      const edges = componentEdges.get(frame.id) ?? []
      if (frame.edgeIndex < edges.length) {
        const next = edges[frame.edgeIndex++]!
        if (!componentEdges.has(next)) continue
        const state = componentVisitState.get(next)
        if (state === 'active') {
          frame.reachesCycle = true
        } else if (state === 'done') {
          if (reachesComponentCycle.get(next)) frame.reachesCycle = true
        } else {
          componentVisitState.set(next, 'active')
          stack.push({ id: next, edgeIndex: 0, reachesCycle: false })
        }
        continue
      }
      componentVisitState.set(frame.id, 'done')
      reachesComponentCycle.set(frame.id, frame.reachesCycle)
      stack.pop()
      if (frame.reachesCycle && stack.length > 0) {
        stack.at(-1)!.reachesCycle = true
      }
    }
  }
  for (const [componentId, reachesCycle] of reachesComponentCycle) {
    if (reachesCycle) {
      pushIssue(issues, `nodes.${componentId}`, 'Component instances contain a recursive cycle')
    }
  }
  return { ok: issues.length === 0, issues }
}

export function assertDocument(document: unknown): CanvasDocument {
  const result = validateDocument(document)
  if (!result.ok) {
    throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'))
  }
  return document as CanvasDocument
}

export function parseCanvasDocument(value: unknown): CanvasDocument {
  return assertDocument(value)
}

export const canvasDocumentSchema: CanvasRuntimeSchema<CanvasDocument> = {
  parse: parseCanvasDocument,
  safeParse(value) {
    try {
      return { success: true, data: parseCanvasDocument(value) }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error('Invalid Canvas document'),
      }
    }
  },
}

export function validateNodeRef(
  document: CanvasDocument,
  value: unknown,
): DocumentValidationResult {
  const issues: DocumentValidationIssue[] = []
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) => !['nodeId', 'instancePath'].includes(key),
    ) ||
    typeof value.nodeId !== 'string' ||
    value.nodeId.length === 0 ||
    value.nodeId.length > 200 ||
    !Array.isArray(value.instancePath) ||
    value.instancePath.length > 100 ||
    value.instancePath.some(
      (id) => typeof id !== 'string' || id.length === 0 || id.length > 200,
    )
  ) {
    pushIssue(issues, '', 'Node reference is malformed')
    return { ok: false, issues }
  }
  const ref = value as unknown as NodeRef
  const source = document.nodes[ref.nodeId]
  if (!source) pushIssue(issues, 'nodeId', 'Referenced node does not exist')
  let expectedComponent: NodeId | null = null
  for (const [index, instanceId] of ref.instancePath.entries()) {
    const instance = document.nodes[instanceId]
    if (!instance || instance.type !== 'instance') {
      pushIssue(issues, `instancePath.${index}`, 'Instance path entry does not exist')
      break
    }
    if (expectedComponent) {
      let parentId = instance.parentId
      let inside = false
      while (parentId) {
        if (parentId === expectedComponent) {
          inside = true
          break
        }
        parentId = document.nodes[parentId]?.parentId ?? null
      }
      if (!inside) {
        pushIssue(issues, `instancePath.${index}`, 'Nested instance is outside its parent component')
      }
    }
    expectedComponent = instance.componentId
  }
  if (expectedComponent && source) {
    let parentId = source.parentId
    let inside = false
    while (parentId) {
      if (parentId === expectedComponent) {
        inside = true
        break
      }
      parentId = document.nodes[parentId]?.parentId ?? null
    }
    if (!inside && source.id !== expectedComponent) {
      pushIssue(issues, 'nodeId', 'Referenced node is outside the instance component')
    }
  }
  return { ok: issues.length === 0, issues }
}

export function parseNodeRef(
  document: CanvasDocument,
  value: unknown,
): NodeRef {
  const result = validateNodeRef(document, value)
  if (!result.ok) {
    throw new Error(
      result.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('\n'),
    )
  }
  return structuredClone(value) as NodeRef
}

export function nodeRefSchema(
  document: CanvasDocument,
): CanvasRuntimeSchema<NodeRef> {
  return {
    parse: (value) => parseNodeRef(document, value),
    safeParse(value) {
      try {
        return { success: true, data: parseNodeRef(document, value) }
      } catch (error) {
        return {
          success: false,
          error:
            error instanceof Error
              ? error
              : new Error('Invalid node reference'),
        }
      }
    },
  }
}

export function validateCommentPin(
  document: CanvasDocument,
  value: unknown,
): DocumentValidationResult {
  const issues: DocumentValidationIssue[] = []
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !['target', 'x', 'y'].includes(key)) ||
    !finite(value.x) ||
    !finite(value.y)
  ) {
    pushIssue(issues, '', 'Comment pin is malformed')
    return { ok: false, issues }
  }
  const target = validateNodeRef(document, value.target)
  for (const issue of target.issues) {
    pushIssue(
      issues,
      issue.path ? `target.${issue.path}` : 'target',
      issue.message,
    )
  }
  return { ok: issues.length === 0, issues }
}

export function canvasCommentPinSchema(
  document: CanvasDocument,
): CanvasRuntimeSchema<CanvasCommentPin> {
  const parse = (value: unknown) => {
    const result = validateCommentPin(document, value)
    if (!result.ok) {
      throw new Error(
        result.issues
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join('\n'),
      )
    }
    return structuredClone(value) as CanvasCommentPin
  }
  return {
    parse,
    safeParse(value) {
      try {
        return { success: true, data: parse(value) }
      } catch (error) {
        return {
          success: false,
          error:
            error instanceof Error
              ? error
              : new Error('Invalid comment pin'),
        }
      }
    },
  }
}
