import {
  createContext,
  createElement,
  memo,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FocusEvent,
  type HTMLAttributes,
  type MouseEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  type WheelEvent,
} from 'react'
import {
  type CanvasApplyResult,
  type CanvasTransaction,
  CanvasEngine,
  preconditionsForNodePatch,
  preconditionsForNodeMove,
  withTransactionPreconditions,
} from './engine'
import {
  type CanvasColor,
  type CanvasDocumentV2,
  type CanvasLength,
  type CanvasNode,
  type CanvasPaint,
  type InstanceNode,
  type NodeId,
  type NodePatch,
  type NodeRef,
  type PageNode,
  canvasId,
  resolveNodeRef,
  resolveNodeAtWidth,
} from './model'

export interface CanvasCamera {
  x: number
  y: number
  zoom: number
}

export interface CanvasSurfaceControls {
  getCamera: () => CanvasCamera
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
  zoomToFit: () => void
  zoomToSelection: () => void
}

export interface CanvasProviderProps {
  engine: CanvasEngine
  children: ReactNode
  readOnly?: boolean
  onTransaction?: (
    transaction: CanvasTransaction,
    result: CanvasApplyResult,
  ) => void | Promise<void>
}

export interface CanvasSurfaceProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  controlsRef?: Ref<CanvasSurfaceControls>
  initialCamera?: Partial<CanvasCamera>
  interactionMode?: 'select' | 'pan'
  onCameraChange?: (camera: CanvasCamera) => void
  onSelectionChange?: (selection: NodeRef[]) => void
  pageWidth?: number
}

type Listener = () => void

function refKey(ref: NodeRef) {
  return `${ref.instancePath.join('/')}:${ref.nodeId}`
}

function sameRef(left: NodeRef | null, right: NodeRef | null) {
  return !!left && !!right && refKey(left) === refKey(right)
}

function parseNodeRef(element: Element): NodeRef | null {
  const nodeId = element.getAttribute('data-loora-node')
  if (!nodeId) return null
  const path = element.getAttribute('data-loora-instance-path')
  return {
    nodeId,
    instancePath: path ? path.split('/').filter(Boolean) : [],
  }
}

export class CanvasSession {
  #selection: NodeRef[] = []
  #editingRoot: NodeRef | null = null
  #listeners = new Set<Listener>()
  #revision = 0

  get selection() {
    return this.#selection
  }

  get editingRoot() {
    return this.#editingRoot
  }

  get revision() {
    return this.#revision
  }

  select(selection: NodeRef[]) {
    const next = selection.map((ref) => ({
      nodeId: ref.nodeId,
      instancePath: [...ref.instancePath],
    }))
    if (
      next.length === this.#selection.length &&
      next.every((ref, index) => sameRef(ref, this.#selection[index] ?? null))
    ) {
      return
    }
    this.#selection = next
    this.#emit()
  }

  setEditingRoot(root: NodeRef | null) {
    if (sameRef(root, this.#editingRoot) || (!root && !this.#editingRoot)) return
    this.#editingRoot = root
      ? { nodeId: root.nodeId, instancePath: [...root.instancePath] }
      : null
    this.#emit()
  }

  subscribe = (listener: Listener) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  #emit() {
    this.#revision += 1
    for (const listener of this.#listeners) listener()
  }
}

export class CanvasDomRegistry {
  #elements = new Map<string, HTMLElement | SVGElement>()
  #listeners = new Set<Listener>()
  #observed = new Set<string>()
  #revision = 0
  #pending = false
  #destroyed = false
  #observer: ResizeObserver | null =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          this.#emit()
        })

  get revision() {
    return this.#revision
  }

  register(ref: NodeRef, element: HTMLElement | SVGElement | null) {
    const key = refKey(ref)
    const current = this.#elements.get(key)
    if (current === element) return
    if (current && current !== element && this.#observed.has(key)) {
      this.#observer?.unobserve(current)
    }
    if (!element) {
      this.#elements.delete(key)
      this.#observed.delete(key)
      this.#emit()
      return
    }
    this.#elements.set(key, element)
    if (this.#observed.has(key)) this.#observer?.observe(element)
    this.#emit()
  }

  get(ref: NodeRef) {
    return this.#elements.get(refKey(ref)) ?? null
  }

  entries() {
    return [...this.#elements.values()]
      .map((element) => {
        const ref = parseNodeRef(element)
        return ref ? { ref, element } : null
      })
      .filter(
        (
          entry,
        ): entry is {
          ref: NodeRef
          element: HTMLElement | SVGElement
        } => !!entry,
      )
  }

  observe(refs: NodeRef[]) {
    const next = new Set(refs.map(refKey))
    for (const key of this.#observed) {
      if (next.has(key)) continue
      const element = this.#elements.get(key)
      if (element) this.#observer?.unobserve(element)
    }
    for (const key of next) {
      if (this.#observed.has(key)) continue
      const element = this.#elements.get(key)
      if (element) this.#observer?.observe(element)
    }
    this.#observed = next
  }

  subscribe = (listener: Listener) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  destroy() {
    this.#observer?.disconnect()
    this.#elements.clear()
    this.#observed.clear()
    this.#destroyed = true
  }

  /**
   * Mounting a page registers one element per node. Notifying synchronously
   * turned that into an O(nodes) storm of overlay renders, each forcing a
   * layout flush. The revision moves immediately; subscribers hear about it
   * once the current task has finished registering.
   */
  #emit() {
    this.#revision += 1
    if (this.#pending) return
    this.#pending = true
    queueMicrotask(() => {
      this.#pending = false
      if (this.#destroyed) return
      for (const listener of this.#listeners) listener()
    })
  }
}

interface CanvasContextValue {
  engine: CanvasEngine
  session: CanvasSession
  registry: CanvasDomRegistry
  readOnly: boolean
  transact: (transaction: CanvasTransaction) => CanvasApplyResult
  undo: () => CanvasApplyResult | null
  redo: () => CanvasApplyResult | null
}

const CanvasContext = createContext<CanvasContextValue | null>(null)

function useCanvasContext() {
  const value = useContext(CanvasContext)
  if (!value) throw new Error('Canvas components must be inside CanvasProvider')
  return value
}

export function CanvasProvider({
  engine,
  children,
  readOnly = false,
  onTransaction,
}: CanvasProviderProps) {
  const session = useMemo(() => new CanvasSession(), [engine])
  const registry = useMemo(() => new CanvasDomRegistry(), [engine])
  const reconcileSession = useCallback(() => {
    const selection = session.selection.filter((ref) =>
      resolveNodeRef(engine.document, ref),
    )
    if (selection.length !== session.selection.length) {
      session.select(selection)
    }
    if (
      session.editingRoot &&
      !resolveNodeRef(engine.document, session.editingRoot)
    ) {
      session.setEditingRoot(null)
    }
  }, [engine, session])
  const transact = useCallback(
    (transaction: CanvasTransaction) => {
      if (readOnly) throw new Error('Canvas is read-only')
      const prepared = withTransactionPreconditions(
        engine.document,
        transaction,
      )
      const result = engine.apply(prepared)
      reconcileSession()
      void onTransaction?.(prepared, result)
      return result
    },
    [engine, onTransaction, readOnly, reconcileSession],
  )
  const undo = useCallback(() => {
    if (readOnly) return null
    const result = engine.undo()
    if (!result) return null
    reconcileSession()
    void onTransaction?.(result.transaction, result)
    return result
  }, [engine, onTransaction, readOnly, reconcileSession])
  const redo = useCallback(() => {
    if (readOnly) return null
    const result = engine.redo()
    if (!result) return null
    reconcileSession()
    void onTransaction?.(result.transaction, result)
    return result
  }, [engine, onTransaction, readOnly, reconcileSession])
  const value = useMemo(
    () => ({ engine, session, registry, readOnly, transact, undo, redo }),
    [engine, readOnly, redo, registry, session, transact, undo],
  )
  useEffect(() => () => registry.destroy(), [registry])
  return <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>
}

export function useCanvasEngine() {
  return useCanvasContext().engine
}

export function useCanvasSession() {
  return useCanvasContext().session
}

export function useCanvasDomRegistry() {
  return useCanvasContext().registry
}

export function useCanvasReadOnly() {
  return useCanvasContext().readOnly
}

export function useCanvasTransaction() {
  return useCanvasContext().transact
}

export function useCanvasHistory() {
  const { engine, undo, redo } = useCanvasContext()
  useSyncExternalStore(engine.subscribe.bind(engine), () => engine.revision, () => engine.revision)
  return {
    undo,
    redo,
    canUndo: engine.canUndo,
    canRedo: engine.canRedo,
  }
}

export function useCanvasDocument() {
  const { engine } = useCanvasContext()
  useSyncExternalStore(engine.subscribe.bind(engine), () => engine.revision, () => engine.revision)
  return engine.document
}

export function useCanvasNode(id: NodeId) {
  const { engine } = useCanvasContext()
  useSyncExternalStore(
    (listener) => engine.subscribeNode(id, listener),
    () => engine.getNodeRevision(id),
    () => engine.getNodeRevision(id),
  )
  return engine.getNode(id)
}

export function useCanvasSelection() {
  const { session } = useCanvasContext()
  useSyncExternalStore(session.subscribe, () => session.revision, () => session.revision)
  return session.selection
}

function colorValue(_document: CanvasDocumentV2, color: CanvasColor) {
  if (typeof color === 'string') return color
  return `var(--loora-token-${color.token.replace(/[^a-zA-Z0-9_-]/g, '-')})`
}

function paintValue(document: CanvasDocumentV2, paint: CanvasPaint) {
  if (paint.type === 'solid') return colorValue(document, paint.color)
  return `linear-gradient(${paint.angle}deg, ${paint.stops
    .map((stop) => `${colorValue(document, stop.color)} ${stop.offset * 100}%`)
    .join(', ')})`
}

function lengthValue(length: CanvasLength, axis: 'width' | 'height') {
  if (length.unit === 'px') return `${length.value}px`
  if (length.unit === 'percent') return `${length.value}%`
  if (length.unit === 'fill') return '100%'
  return axis === 'width' ? 'fit-content' : 'auto'
}

function patchNode(node: CanvasNode, patch: NodePatch | undefined): CanvasNode {
  if (!patch) return node
  return {
    ...node,
    ...patch,
    layout: patch.layout ? { ...node.layout, ...patch.layout } : node.layout,
    style: patch.style
      ? {
          ...node.style,
          ...patch.style,
          typography: patch.style.typography
            ? { ...node.style.typography, ...patch.style.typography }
            : node.style.typography,
        }
      : node.style,
  } as CanvasNode
}

function nodeCss(
  document: CanvasDocumentV2,
  node: CanvasNode,
  isPageRoot = false,
): CSSProperties {
  const { layout, style } = node
  const css: CSSProperties = {
    boxSizing: 'border-box',
    position: layout.position === 'absolute' || isPageRoot ? 'absolute' : 'relative',
    left: layout.position === 'absolute' || isPageRoot ? layout.x : undefined,
    top: layout.position === 'absolute' || isPageRoot ? layout.y : undefined,
    width: lengthValue(layout.width, 'width'),
    height: lengthValue(layout.height, 'height'),
    minWidth: layout.minWidth,
    maxWidth: layout.maxWidth,
    minHeight: layout.minHeight,
    maxHeight: layout.maxHeight,
    aspectRatio: layout.aspectRatio,
    opacity: style.opacity,
    overflow: style.overflow,
    display: node.hidden ? 'none' : undefined,
    transform: node.rotation ? `rotate(${node.rotation}deg)` : undefined,
    transformOrigin: 'center',
    borderRadius: Array.isArray(style.radius)
      ? style.radius.map((radius) => `${radius}px`).join(' ')
      : style.radius,
    color:
      node.type === 'text' && style.fills[0]?.type === 'solid'
        ? colorValue(document, style.fills[0].color)
        : undefined,
    background:
      node.type !== 'text' && style.fills.length > 0
        ? style.fills.map((paint) => paintValue(document, paint)).join(',')
        : undefined,
    border: style.stroke
      ? `${style.stroke.width}px ${style.stroke.style ?? 'solid'} ${colorValue(document, style.stroke.color)}`
      : undefined,
    boxShadow:
      style.shadows.length > 0
        ? style.shadows
            .map(
              (shadow) =>
                `${shadow.inset ? 'inset ' : ''}${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.spread}px ${colorValue(document, shadow.color)}`,
            )
            .join(',')
        : undefined,
    mixBlendMode: style.blendMode as CSSProperties['mixBlendMode'],
    userSelect: 'none',
  }
  if (layout.mode === 'flex') {
    css.display = node.hidden ? 'none' : 'flex'
    css.flexDirection = layout.direction ?? 'row'
    css.flexWrap = layout.wrap ? 'wrap' : 'nowrap'
    css.gap = layout.gap
    css.alignItems = layout.align === 'start' || layout.align === 'end'
      ? `flex-${layout.align}`
      : layout.align
    css.justifyContent =
      layout.justify === 'start' || layout.justify === 'end'
        ? `flex-${layout.justify}`
        : layout.justify
  } else if (layout.mode === 'grid') {
    css.display = node.hidden ? 'none' : 'grid'
    css.gridTemplateColumns = `repeat(${Math.max(1, layout.columns ?? 1)}, minmax(0, 1fr))`
    css.gap = layout.gap
    css.alignItems = layout.align === 'start' || layout.align === 'end'
      ? `flex-${layout.align}`
      : layout.align
    css.justifyContent =
      layout.justify === 'start' || layout.justify === 'end'
        ? `flex-${layout.justify}`
        : layout.justify
  }
  if (layout.padding) {
    css.padding = `${layout.padding.top}px ${layout.padding.right}px ${layout.padding.bottom}px ${layout.padding.left}px`
  }
  if (style.typography) {
    css.fontFamily = style.typography.family
    css.fontSize = style.typography.size
    css.fontWeight = style.typography.weight
    css.lineHeight = style.typography.lineHeight
    css.letterSpacing = style.typography.letterSpacing
    css.textAlign = style.typography.align
    css.textDecoration = style.typography.decoration
    css.textTransform = style.typography.transform
  }
  if (node.type === 'shape' && node.shape === 'ellipse') css.borderRadius = '50%'
  return css
}

function useChildren(parentId: NodeId | null) {
  const { engine } = useCanvasContext()
  useSyncExternalStore(
    (listener) =>
      parentId === null ? engine.subscribe(listener) : engine.subscribeNode(parentId, listener),
    () => (parentId === null ? engine.revision : engine.getNodeRevision(parentId)),
    () => (parentId === null ? engine.revision : engine.getNodeRevision(parentId)),
  )
  return engine.getChildren(parentId)
}

interface RenderNodeProps {
  id: NodeId
  instance?: InstanceNode
  instancePath?: NodeId[]
  width: number
  topLevel?: boolean
}

function nodeRefFor(nodeId: NodeId, instancePath: NodeId[] = []): NodeRef {
  return { nodeId, instancePath }
}

const RenderChildren = memo(function RenderChildren({
  parentId,
  instance,
  instancePath,
  width,
}: {
  parentId: NodeId
  instance?: InstanceNode
  instancePath: NodeId[]
  width: number
}) {
  const children = useChildren(parentId)
  return children.map((child) => (
    <CanvasNodeRenderer
      key={`${instancePath.join('/')}:${child.id}`}
      id={child.id}
      instance={instance}
      instancePath={instancePath}
      width={width}
    />
  ))
})

function useVisibility(elementRef: RefObject<Element | null>, forceVisible: boolean) {
  const [visible, setVisible] = useState(forceVisible)
  useEffect(() => {
    if (forceVisible) {
      setVisible(true)
      return
    }
    const element = elementRef.current
    if (!element || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? true),
      { rootMargin: '600px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [elementRef, forceVisible])
  return visible || forceVisible
}

function RawCanvasNodeRenderer({
  id,
  instance,
  instancePath = [],
  width,
  topLevel = false,
}: RenderNodeProps) {
  const source = useCanvasNode(id)
  const liveInstance = useCanvasNode(instance?.id ?? '')
  const { engine, registry, session, readOnly, transact } = useCanvasContext()
  const elementRef = useRef<HTMLElement | SVGElement | null>(null)
  const [editingText, setEditingText] = useState(false)
  const ref = nodeRefFor(id, instancePath)
  const isSelected = session.selection.some((selected) => sameRef(selected, ref))
  const visible = useVisibility(elementRef as RefObject<Element | null>, !topLevel || isSelected)
  const setElement = useCallback(
    (element: HTMLElement | SVGElement | null) => {
      elementRef.current = element
      registry.register(ref, element)
    },
    [registry, id, instancePath.join('/')],
  )
  if (!source) return null

  const currentInstance =
    instancePath.length === 1 && liveInstance?.type === 'instance'
      ? liveInstance
      : instance
  const resolved = resolveNodeAtWidth(engine.document, source, width)
  const component = currentInstance
    ? engine.document.nodes[currentInstance.componentId]
    : null
  const variant =
    currentInstance?.variant ??
    (component?.type === 'component'
      ? component.defaultVariant
      : undefined)
  const variantPatch =
    component?.type === 'component' && variant
      ? component.variantOverrides[variant]?.[source.id]
      : undefined
  const node = patchNode(
    patchNode(resolved, variantPatch),
    currentInstance?.overrides[source.id],
  )
  const insideInstanceRoot =
    node.type === 'component' && currentInstance !== undefined
  const path =
    node.type === 'instance'
      ? [...instancePath, node.id]
      : instancePath
  const isPage = node.type === 'page'
  const common = {
    ref: setElement,
    'data-loora-node': node.id,
    'data-loora-instance-path': instancePath.join('/'),
    'data-loora-node-type': node.type,
    'data-loora-locked': node.locked ? 'true' : undefined,
    style: {
      ...nodeCss(engine.document, node, topLevel),
      ...(isPage && topLevel
        ? {
            width: `${width}px`,
            minHeight: `${node.viewport.minHeight}px`,
          }
        : {}),
      ...(insideInstanceRoot
        ? {
            position: 'relative',
            left: 0,
            top: 0,
            width: '100%',
            height: '100%',
            minWidth: undefined,
            maxWidth: undefined,
            minHeight: undefined,
            maxHeight: undefined,
            aspectRatio: undefined,
          }
        : {}),
      contentVisibility: topLevel ? 'auto' : undefined,
      contain: topLevel ? 'layout style paint' : undefined,
    } as CSSProperties,
  }

  const onTextBlur = (event: FocusEvent<HTMLDivElement>) => {
    setEditingText(false)
    if (readOnly) return
    const text = event.currentTarget.innerText.replace(/\r\n?/g, '\n')
    if (node.type !== 'text' || text === node.text) return
    transact({
      id: canvasId('tx'),
      label: 'Edit text',
      preconditions: currentInstance
        ? undefined
        : preconditionsForNodePatch(engine.document, node.id, {
            text: node.text,
            runs: node.runs,
          }),
      operations: currentInstance
        ? [{
            type: 'instance.patchOverride',
            id: currentInstance.id,
            targetId: node.id,
            patch: { text, runs: [] },
          }]
        : [{
            type: 'node.patch',
            id: node.id,
            patch: { text, runs: [] },
          }],
    })
  }
  const onDoubleClick = (event: MouseEvent) => {
    event.stopPropagation()
    if (node.type === 'text' && !node.locked && !readOnly) {
      setEditingText(true)
      requestAnimationFrame(() => {
        const element = registry.get(ref)
        if (element instanceof HTMLElement) {
          element.focus()
          const range = document.createRange()
          range.selectNodeContents(element)
          const selection = window.getSelection()
          selection?.removeAllRanges()
          selection?.addRange(range)
        }
      })
      return
    }
    if (
      node.type === 'frame' ||
      node.type === 'group' ||
      node.type === 'instance' ||
      node.type === 'page' ||
      node.type === 'component'
    ) {
      session.select([ref])
      session.setEditingRoot(ref)
    }
  }

  if (node.type === 'component') {
    return (
      <div
        {...common}
        data-loora-component-definition={
          insideInstanceRoot ? undefined : 'true'
        }
        data-loora-component-root={
          insideInstanceRoot ? currentInstance.id : undefined
        }
        onDoubleClick={onDoubleClick}
      >
        {visible ? (
          <RenderChildren
            parentId={node.id}
            instance={currentInstance}
            instancePath={instancePath}
            width={width}
          />
        ) : null}
      </div>
    )
  }
  if (node.type === 'text') {
    return (
      <div
        {...common}
        contentEditable={editingText ? 'plaintext-only' : false}
        suppressContentEditableWarning
        data-loora-text-editing={editingText ? 'true' : undefined}
        onBlur={onTextBlur}
        onDoubleClick={onDoubleClick}
        style={{
          ...common.style,
          userSelect: editingText ? 'text' : 'none',
          cursor: editingText ? 'text' : undefined,
          whiteSpace: 'pre-wrap',
          outline: 'none',
        }}
      >
        {node.text}
      </div>
    )
  }
  if (node.type === 'image') {
    return (
      <img
        {...common}
        src={node.src}
        alt={node.alt}
        draggable={false}
        onDoubleClick={onDoubleClick}
        style={{ ...common.style, objectFit: node.fit }}
      />
    )
  }
  if (node.type === 'vector') {
    return (
      <svg {...common} viewBox={node.viewBox} onDoubleClick={onDoubleClick}>
        {node.paths.map((vectorPath, index) => (
          <path
            key={`${node.id}:${index}`}
            d={vectorPath.d}
            fill={vectorPath.fill ? colorValue(engine.document, vectorPath.fill) : 'none'}
            stroke={vectorPath.stroke ? colorValue(engine.document, vectorPath.stroke) : undefined}
            strokeWidth={vectorPath.strokeWidth}
          />
        ))}
      </svg>
    )
  }
  if (node.type === 'shape') {
    return <div {...common} onDoubleClick={onDoubleClick} />
  }
  if (node.type === 'instance') {
    const component = engine.document.nodes[node.componentId]
    if (!component || component.type !== 'component') return null
    return (
      <div
        {...common}
        data-loora-component={component.id}
        data-loora-variant={node.variant ?? component.defaultVariant}
        onDoubleClick={onDoubleClick}
      >
        {visible ? (
          <CanvasNodeRenderer
            id={component.id}
            instance={node}
            instancePath={path}
            width={width}
          />
        ) : null}
      </div>
    )
  }
  const tag = node.type === 'frame'
    ? node.semanticTag
    : node.type === 'page'
      ? 'main'
      : 'div'
  return createElement(
    tag,
    {
      ...common,
      onDoubleClick,
      'data-loora-page': isPage ? 'true' : undefined,
    },
    visible ? (
      <RenderChildren
        parentId={node.id}
        instance={currentInstance}
        instancePath={instancePath}
        width={width}
      />
    ) : null,
  )
}

export const CanvasNodeRenderer = memo(RawCanvasNodeRenderer)

function refAncestors(element: Element, scene: Element) {
  const result: { element: Element; ref: NodeRef }[] = []
  let current: Element | null = element.closest('[data-loora-node]')
  while (current && scene.contains(current)) {
    const ref = parseNodeRef(current)
    if (ref) result.push({ element: current, ref })
    current = current.parentElement?.closest('[data-loora-node]') ?? null
  }
  return result
}

function chooseHit(
  event: PointerEvent | ReactPointerEvent,
  scene: HTMLElement,
  session: CanvasSession,
  canvasDocument: CanvasDocumentV2,
  current: NodeRef | null,
) {
  const hits = document
    .elementsFromPoint(event.clientX, event.clientY)
    .filter((element) => scene.contains(element) && element.hasAttribute('data-loora-node'))
    .filter((element) => element.getAttribute('data-loora-locked') !== 'true')
  if (hits.length === 0) return null
  if (event.metaKey || event.ctrlKey) return parseNodeRef(hits[0]!)

  const editingRoot = session.editingRoot
  const ancestry = refAncestors(hits[0]!, scene)
  if (!editingRoot) {
    // Keep the current selection when the click lands inside it, so a press on
    // an already-selected layer starts a drag instead of jumping the selection.
    // Descending one level is decided on pointer-up, by drillHit.
    const currentIndex = current
      ? ancestry.findIndex(({ ref }) => sameRef(ref, current))
      : -1
    if (currentIndex >= 0) return ancestry[currentIndex]!.ref
    // Roots are containers, not layers. Returning the outermost ancestor made
    // every click re-select the Page, so nothing inside one was reachable.
    // Pick the top-level layer instead; only bare background selects the root.
    const inside = ancestry.filter(({ ref }) => {
      const type = canvasDocument.nodes[ref.nodeId]?.type
      return type !== 'page' && type !== 'component'
    })
    return inside.at(-1)?.ref ?? ancestry.at(-1)?.ref ?? parseNodeRef(hits[0]!)
  }
  const rootIndex = ancestry.findIndex(({ ref }) => sameRef(ref, editingRoot))
  if (rootIndex < 0) return editingRoot
  return ancestry[Math.max(0, rootIndex - 1)]?.ref ?? editingRoot
}

/**
 * One level below `current` at this point, or null when nothing is nested
 * there. Applied on pointer-up so a click walks into a container while a drag
 * on the same spot still moves what was already selected.
 */
function drillHit(
  event: PointerEvent | ReactPointerEvent,
  scene: HTMLElement,
  current: NodeRef | null,
) {
  if (!current) return null
  const hits = document
    .elementsFromPoint(event.clientX, event.clientY)
    .filter((element) => scene.contains(element) && element.hasAttribute('data-loora-node'))
    .filter((element) => element.getAttribute('data-loora-locked') !== 'true')
  if (hits.length === 0) return null
  const ancestry = refAncestors(hits[0]!, scene)
  const index = ancestry.findIndex(({ ref }) => sameRef(ref, current))
  if (index <= 0) return null
  return ancestry[index - 1]!.ref
}

function cycleHit(
  event: ReactPointerEvent,
  scene: HTMLElement,
  current: NodeRef | null,
) {
  const refs = document
    .elementsFromPoint(event.clientX, event.clientY)
    .filter((element) => scene.contains(element) && element.hasAttribute('data-loora-node'))
    .filter((element) => element.getAttribute('data-loora-locked') !== 'true')
    .map(parseNodeRef)
    .filter((ref): ref is NodeRef => !!ref)
    .filter((ref, index, all) => all.findIndex((candidate) => sameRef(candidate, ref)) === index)
  if (refs.length === 0) return null
  const index = current ? refs.findIndex((ref) => sameRef(ref, current)) : -1
  return refs[(index + 1) % refs.length] ?? refs[0]!
}

function isTextEntryTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
}

function rootSelection(
  document: CanvasDocumentV2,
  selection: NodeRef[],
) {
  const selected = new Set(selection.map(refKey))
  return selection.filter((ref) => {
    let parentId = document.nodes[ref.nodeId]?.parentId ?? null
    while (parentId) {
      if (
        selected.has(
          refKey({
            nodeId: parentId,
            instancePath: ref.instancePath,
          }),
        )
      ) {
        return false
      }
      parentId = document.nodes[parentId]?.parentId ?? null
    }
    return true
  })
}

function nearestSnap(
  moving: number[],
  targets: number[],
  threshold = 6,
) {
  let best: { delta: number; position: number } | null = null
  for (const movingPosition of moving) {
    for (const target of targets) {
      const delta = target - movingPosition
      if (
        Math.abs(delta) <= threshold &&
        (!best || Math.abs(delta) < Math.abs(best.delta))
      ) {
        best = { delta, position: target }
      }
    }
  }
  return best
}

const HANDLES: [string, -1 | 0 | 1, -1 | 0 | 1, CSSProperties['cursor']][] = [
  ['nw', -1, -1, 'nwse-resize'],
  ['n', 0, -1, 'ns-resize'],
  ['ne', 1, -1, 'nesw-resize'],
  ['e', 1, 0, 'ew-resize'],
  ['se', 1, 1, 'nwse-resize'],
  ['s', 0, 1, 'ns-resize'],
  ['sw', -1, 1, 'nesw-resize'],
  ['w', -1, 0, 'ew-resize'],
]

const HANDLE_OFFSETS: Record<string, [-1 | 0 | 1, -1 | 0 | 1]> =
  Object.fromEntries(
    HANDLES.map(([name, horizontal, vertical]) => [name, [horizontal, vertical]]),
  )

interface OverlayWorldRect {
  left: number
  top: number
  width: number
  height: number
}

function SelectionOverlay({
  sceneRef,
  cameraRef,
  syncRef,
  marqueeRef,
  verticalGuideRef,
  horizontalGuideRef,
}: {
  sceneRef: RefObject<HTMLDivElement | null>
  cameraRef: MutableRefObject<CanvasCamera>
  syncRef: MutableRefObject<((remeasure?: boolean) => void) | null>
  marqueeRef: RefObject<SVGRectElement | null>
  verticalGuideRef: RefObject<SVGLineElement | null>
  horizontalGuideRef: RefObject<SVGLineElement | null>
}) {
  const { engine, registry, session, readOnly, transact } = useCanvasContext()
  useSyncExternalStore(session.subscribe, () => session.revision, () => session.revision)
  useSyncExternalStore(registry.subscribe, () => registry.revision, () => registry.revision)
  useSyncExternalStore(engine.subscribe.bind(engine), () => engine.revision, () => engine.revision)
  const [, refresh] = useState(0)
  const selected = session.selection[0] ?? null
  const element = selected ? registry.get(selected) : null
  const groupRef = useRef<SVGGElement | null>(null)
  const outlineRef = useRef<SVGRectElement | null>(null)
  const labelRef = useRef<SVGGElement | null>(null)
  const handleRefs = useRef(new Map<string, SVGRectElement>())
  const worldRef = useRef<OverlayWorldRect | null>(null)

  /**
   * Measured against the scene, so the result is camera-independent. Reading
   * viewport coordinates here left the overlay stranded wherever the camera
   * happened to be during the last React render.
   */
  const measure = useCallback(() => {
    const scene = sceneRef.current
    if (!element || !scene) {
      worldRef.current = null
      return
    }
    const rect = element.getBoundingClientRect()
    const sceneRect = scene.getBoundingClientRect()
    const zoom = cameraRef.current.zoom || 1
    worldRef.current = {
      left: (rect.left - sceneRect.left) / zoom,
      top: (rect.top - sceneRect.top) / zoom,
      width: rect.width / zoom,
      height: rect.height / zoom,
    }
  }, [cameraRef, element, sceneRef])

  /** Attribute writes only, never a React render. */
  const sync = useCallback((remeasure?: boolean) => {
    if (remeasure) measure()
    const group = groupRef.current
    if (!group) return
    const world = worldRef.current
    if (!world) {
      group.style.display = 'none'
      return
    }
    group.style.display = ''
    const camera = cameraRef.current
    const left = world.left * camera.zoom + camera.x
    const top = world.top * camera.zoom + camera.y
    const width = world.width * camera.zoom
    const height = world.height * camera.zoom
    const outline = outlineRef.current
    if (outline) {
      outline.setAttribute('x', String(left))
      outline.setAttribute('y', String(top))
      outline.setAttribute('width', String(Math.max(0, width)))
      outline.setAttribute('height', String(Math.max(0, height)))
    }
    labelRef.current?.setAttribute(
      'transform',
      `translate(${left}, ${Math.max(2, top - 23)})`,
    )
    for (const [name, handle] of handleRefs.current) {
      const [horizontal, vertical] = HANDLE_OFFSETS[name] ?? [0, 0]
      const x =
        left + (horizontal < 0 ? 0 : horizontal > 0 ? width : width / 2)
      const y = top + (vertical < 0 ? 0 : vertical > 0 ? height : height / 2)
      handle.setAttribute('x', String(x - 4))
      handle.setAttribute('y', String(y - 4))
    }
  }, [cameraRef, measure])

  useLayoutEffect(() => {
    syncRef.current = sync
    return () => {
      if (syncRef.current === sync) syncRef.current = null
    }
  }, [sync, syncRef])

  useLayoutEffect(() => {
    measure()
    sync()
  })

  useLayoutEffect(() => {
    registry.observe([
      ...session.selection,
      ...Object.values(engine.document.nodes)
        .filter((node) => node.parentId === null && node.type === 'page')
        .map((node) => nodeRefFor(node.id)),
    ])
    const onScroll = () => refresh((value) => value + 1)
    window.addEventListener('resize', onScroll)
    return () => window.removeEventListener('resize', onScroll)
  }, [engine, registry, session.revision])

  const source = selected ? engine.getNode(selected.nodeId) : null
  const instanceId = selected?.instancePath.at(-1)

  const startResize = (
    event: ReactPointerEvent<SVGRectElement>,
    horizontal: -1 | 0 | 1,
    vertical: -1 | 0 | 1,
  ) => {
    if (!source || !element || !selected || source.locked) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startY = event.clientY
    const start = element.getBoundingClientRect()
    const original = element.getAttribute('style') ?? ''
    let latestX = 0
    let latestY = 0
    let resizeFrame: number | null = null
    const applyPreview = () => {
      resizeFrame = null
      const width = Math.max(
        1,
        start.width / cameraRef.current.zoom + latestX * horizontal,
      )
      const height = Math.max(
        1,
        start.height / cameraRef.current.zoom + latestY * vertical,
      )
      const translateX = horizontal < 0 ? latestX : 0
      const translateY = vertical < 0 ? latestY : 0
      ;(element as HTMLElement).style.width = `${width}px`
      ;(element as HTMLElement).style.height = `${height}px`
      ;(element as HTMLElement).style.transform =
        `translate(${translateX}px, ${translateY}px) rotate(${source.rotation}deg)`
      // Attribute writes only. A React render per pointer frame was the other
      // half of the resize stutter.
      sync(true)
    }
    const onMove = (moveEvent: PointerEvent) => {
      latestX = (moveEvent.clientX - startX) / cameraRef.current.zoom
      latestY = (moveEvent.clientY - startY) / cameraRef.current.zoom
      if (resizeFrame === null) {
        resizeFrame = requestAnimationFrame(applyPreview)
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
      element.setAttribute('style', original)
      const width = Math.max(
        1,
        source.layout.width.unit === 'px'
          ? source.layout.width.value + latestX * horizontal
          : start.width / cameraRef.current.zoom + latestX * horizontal,
      )
      const height = Math.max(
        1,
        source.layout.height.unit === 'px'
          ? source.layout.height.value + latestY * vertical
          : start.height / cameraRef.current.zoom + latestY * vertical,
      )
      const patch: NodePatch = {
        layout: {
          width: { unit: 'px', value: width },
          height: { unit: 'px', value: height },
          x: source.layout.x + (horizontal < 0 ? latestX : 0),
          y: source.layout.y + (vertical < 0 ? latestY : 0),
        },
      }
      transact({
        id: canvasId('tx'),
        label: 'Resize node',
        preconditions: instanceId
          ? undefined
          : preconditionsForNodePatch(engine.document, source.id, patch),
        operations: instanceId
          ? [{
              type: 'instance.patchOverride',
              id: instanceId,
              targetId: source.id,
              patch,
            }]
          : [{ type: 'node.patch', id: source.id, patch }],
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }

  const label = source?.name ?? ''
  const labelWidth = Math.min(240, Math.max(44, label.length * 6.5 + 12))
  return (
    <svg
      data-loora-viewport-overlay
      aria-label="Canvas selection controls"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible',
        zIndex: 20,
      }}
    >
      <line
        ref={verticalGuideRef}
        data-loora-guide="vertical"
        x1="0"
        x2="0"
        y1="0"
        y2="100%"
        stroke="#e056fd"
        strokeWidth="1"
        strokeDasharray="4 3"
        style={{ display: 'none' }}
      />
      <line
        ref={horizontalGuideRef}
        data-loora-guide="horizontal"
        x1="0"
        x2="100%"
        y1="0"
        y2="0"
        stroke="#e056fd"
        strokeWidth="1"
        strokeDasharray="4 3"
        style={{ display: 'none' }}
      />
      <rect
        ref={marqueeRef}
        data-loora-marquee
        x="0"
        y="0"
        width="0"
        height="0"
        fill="rgba(108, 92, 231, .1)"
        stroke="#6c5ce7"
        strokeWidth="1"
        style={{ display: 'none' }}
      />
      {source && element && !source.locked ? (
        <g ref={groupRef} data-loora-selection-overlay>
          <rect
            ref={outlineRef}
            x="0"
            y="0"
            width="0"
            height="0"
            fill="none"
            stroke="#6c5ce7"
            strokeWidth="1.5"
          />
          <g ref={labelRef}>
            <rect
              width={labelWidth}
              height="18"
              rx="4"
              fill="#6c5ce7"
            />
            <text
              x="6"
              y="12.5"
              fill="#fff"
              fontFamily="ui-sans-serif, system-ui"
              fontSize="11"
            >
              {label}
            </text>
          </g>
          {readOnly
            ? null
            : HANDLES.map(([name, horizontal, vertical, cursor]) => (
                <rect
                  key={name}
                  ref={(node) => {
                    if (node) handleRefs.current.set(name, node)
                    else handleRefs.current.delete(name)
                  }}
                  role="button"
                  aria-label={`Resize ${name}`}
                  x="0"
                  y="0"
                  width="8"
                  height="8"
                  rx="2"
                  fill="#fff"
                  stroke="#6c5ce7"
                  strokeWidth="1"
                  onPointerDown={(event) =>
                    startResize(event, horizontal, vertical)
                  }
                  style={{ pointerEvents: 'auto', cursor }}
                />
              ))}
        </g>
      ) : null}
    </svg>
  )
}

function RootNodes({ width }: { width: number }) {
  const { engine, session } = useCanvasContext()
  const roots = useChildren(null)
  useSyncExternalStore(
    session.subscribe,
    () => session.revision,
    () => session.revision,
  )
  const editingRoot = session.editingRoot
  if (editingRoot && editingRoot.instancePath.length === 0) {
    let root = engine.getNode(editingRoot.nodeId)
    while (root?.parentId) root = engine.getNode(root.parentId)
    if (root?.type === 'component') {
      const componentWidth =
        root.layout.width.unit === 'px'
          ? root.layout.width.value
          : width
      return (
        <CanvasNodeRenderer
          key={root.id}
          id={root.id}
          width={componentWidth}
          topLevel
        />
      )
    }
  }
  return roots
    .filter((node) => node.type !== 'component')
    .map((node) => (
      <CanvasNodeRenderer
        key={node.id}
        id={node.id}
        width={width}
        topLevel
      />
    ))
}

function CanvasTokenStyles() {
  const { engine } = useCanvasContext()
  useSyncExternalStore(
    engine.subscribe.bind(engine),
    () => engine.revision,
    () => engine.revision,
  )
  const document = engine.document
  const declarations = Object.values(document.tokens)
    .map((token) => {
      const value = token.modes?.[document.activeThemeId] ?? token.value
      return `--loora-token-${token.id.replace(/[^a-zA-Z0-9_-]/g, '-')}:${value};`
    })
    .join('')
  return <style>{`[data-loora-canvas-surface]{${declarations}}`}</style>
}

export function CanvasSurface({
  controlsRef,
  initialCamera,
  interactionMode = 'select',
  onCameraChange,
  onSelectionChange,
  pageWidth = 1440,
  className,
  style,
  ...props
}: CanvasSurfaceProps) {
  const { engine, registry, session, readOnly, transact, undo, redo } = useCanvasContext()
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<HTMLDivElement | null>(null)
  const cameraRef = useRef<CanvasCamera>({
    x: initialCamera?.x ?? 80,
    y: initialCamera?.y ?? 80,
    zoom: initialCamera?.zoom ?? 0.75,
  })
  const spaceHeld = useRef(false)
  const drag = useRef<{
    ref: NodeRef
    element: HTMLElement | SVGElement
    source: CanvasNode
    x: number
    y: number
    latestX: number
    latestY: number
    clientX: number
    clientY: number
    startRect: DOMRect
    snapX: number[]
    snapY: number[]
    guideX: number | null
    guideY: number | null
    originalTransform: string
  } | null>(null)
  const pan = useRef<{ x: number; y: number; cameraX: number; cameraY: number } | null>(null)
  const drill = useRef<{ ref: NodeRef | null; x: number; y: number } | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{
    ids: [number, number]
    distance: number
    startZoom: number
    worldX: number
    worldY: number
  } | null>(null)
  const marquee = useRef<{
    x: number
    y: number
    latestX: number
    latestY: number
    additive: boolean
  } | null>(null)
  const overlaySyncRef = useRef<((remeasure?: boolean) => void) | null>(null)
  const marqueeElementRef = useRef<SVGRectElement | null>(null)
  const verticalGuideRef = useRef<SVGLineElement | null>(null)
  const horizontalGuideRef = useRef<SVGLineElement | null>(null)
  const frame = useRef<number | null>(null)

  const hideGuides = () => {
    if (verticalGuideRef.current) {
      verticalGuideRef.current.style.display = 'none'
    }
    if (horizontalGuideRef.current) {
      horizontalGuideRef.current.style.display = 'none'
    }
  }

  const applyCamera = useCallback(() => {
    if (!sceneRef.current) return
    const camera = cameraRef.current
    sceneRef.current.style.transform =
      `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.zoom})`
    overlaySyncRef.current?.()
  }, [])

  const setCamera = useCallback(
    (camera: CanvasCamera) => {
      cameraRef.current = camera
      applyCamera()
      onCameraChange?.({ ...camera })
    },
    [applyCamera, onCameraChange],
  )

  const zoomAroundCenter = useCallback(
    (zoom: number) => {
      const surface = surfaceRef.current
      if (!surface) return
      const rect = surface.getBoundingClientRect()
      const current = cameraRef.current
      const nextZoom = Math.min(4, Math.max(0.08, zoom))
      const worldX = (rect.width / 2 - current.x) / current.zoom
      const worldY = (rect.height / 2 - current.y) / current.zoom
      setCamera({
        x: rect.width / 2 - worldX * nextZoom,
        y: rect.height / 2 - worldY * nextZoom,
        zoom: nextZoom,
      })
    },
    [setCamera],
  )

  const zoomToBounds = useCallback(
    (bounds: { left: number; top: number; right: number; bottom: number }) => {
      const surface = surfaceRef.current
      if (!surface) return
      const rect = surface.getBoundingClientRect()
      const width = Math.max(1, bounds.right - bounds.left)
      const height = Math.max(1, bounds.bottom - bounds.top)
      const padding = Math.min(
        80,
        Math.max(24, Math.min(rect.width, rect.height) * 0.08),
      )
      const zoom = Math.min(
        4,
        Math.max(
          0.08,
          Math.min(
            Math.max(1, rect.width - padding * 2) / width,
            Math.max(1, rect.height - padding * 2) / height,
          ),
        ),
      )
      setCamera({
        x:
          rect.width / 2 -
          ((bounds.left + bounds.right) / 2) * zoom,
        y:
          rect.height / 2 -
          ((bounds.top + bounds.bottom) / 2) * zoom,
        zoom,
      })
    },
    [setCamera],
  )

  useImperativeHandle(
    controlsRef,
    () => ({
      getCamera: () => ({ ...cameraRef.current }),
      zoomIn: () => zoomAroundCenter(cameraRef.current.zoom * 1.2),
      zoomOut: () => zoomAroundCenter(cameraRef.current.zoom / 1.2),
      zoomReset: () => zoomAroundCenter(1),
      zoomToFit: () => {
        const pages = Object.values(engine.document.nodes).filter(
          (node): node is PageNode =>
            node.type === 'page' && !node.hidden,
        )
        if (pages.length === 0) return
        zoomToBounds({
          left: Math.min(...pages.map((page) => page.layout.x)),
          top: Math.min(...pages.map((page) => page.layout.y)),
          right: Math.max(
            ...pages.map(
              (page) =>
                page.layout.x +
                (page.layout.width.unit === 'px'
                  ? page.layout.width.value
                  : page.viewport.width),
            ),
          ),
          bottom: Math.max(
            ...pages.map(
              (page) =>
                page.layout.y +
                (page.layout.height.unit === 'px'
                  ? page.layout.height.value
                  : page.viewport.minHeight),
            ),
          ),
        })
      },
      zoomToSelection: () => {
        const surface = surfaceRef.current
        if (!surface || session.selection.length === 0) return
        const surfaceRect = surface.getBoundingClientRect()
        const rects = session.selection
          .map((ref) => registry.get(ref)?.getBoundingClientRect())
          .filter(
            (rect): rect is DOMRect =>
              !!rect && rect.width > 0 && rect.height > 0,
          )
        if (rects.length === 0) return
        const camera = cameraRef.current
        zoomToBounds({
          left:
            (Math.min(...rects.map((rect) => rect.left)) -
              surfaceRect.left -
              camera.x) /
            camera.zoom,
          top:
            (Math.min(...rects.map((rect) => rect.top)) -
              surfaceRect.top -
              camera.y) /
            camera.zoom,
          right:
            (Math.max(...rects.map((rect) => rect.right)) -
              surfaceRect.left -
              camera.x) /
            camera.zoom,
          bottom:
            (Math.max(...rects.map((rect) => rect.bottom)) -
              surfaceRect.top -
              camera.y) /
            camera.zoom,
        })
      },
    }),
    [engine, registry, session, zoomAroundCenter, zoomToBounds],
  )

  useLayoutEffect(applyCamera, [applyCamera])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) {
        if (
          event.key === 'Escape' &&
          event.target instanceof HTMLElement &&
          event.target.isContentEditable
        ) {
          event.target.blur()
        }
        return
      }
      if (event.code === 'Space' && !event.repeat) {
        spaceHeld.current = true
        if (surfaceRef.current) surfaceRef.current.style.cursor = 'grab'
      }
      if (!readOnly && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 'a'
      ) {
        event.preventDefault()
        const editingRoot = session.editingRoot
        const rootNode = editingRoot
          ? resolveNodeRef(engine.document, editingRoot, pageWidth)
          : null
        const parentId =
          rootNode?.type === 'instance'
            ? rootNode.componentId
            : editingRoot?.nodeId ?? null
        const instancePath =
          rootNode?.type === 'instance' && editingRoot
            ? [...editingRoot.instancePath, rootNode.id]
            : editingRoot?.instancePath ?? []
        session.select(
          engine
            .getChildren(parentId)
            .filter(
              (node) =>
                !node.hidden &&
                !node.locked &&
                (parentId !== null || node.type === 'page'),
            )
            .map((node) => ({
              nodeId: node.id,
              instancePath,
            })),
        )
        return
      }
      if (
        !readOnly &&
        (event.key === 'Delete' || event.key === 'Backspace') &&
        session.selection.length > 0
      ) {
        event.preventDefault()
        const operations: CanvasTransaction['operations'] = []
        for (const ref of rootSelection(
          engine.document,
          session.selection,
        )) {
          const instanceId = ref.instancePath.at(-1)
          if (instanceId) {
            operations.push({
              type: 'instance.patchOverride',
              id: instanceId,
              targetId: ref.nodeId,
              patch: { hidden: true },
            })
          } else {
            operations.push({ type: 'node.delete', id: ref.nodeId })
          }
        }
        if (operations.length > 0) {
          transact({
            id: canvasId('tx'),
            label: 'Delete selection',
            operations,
          })
          session.select([])
        }
        return
      }
      if (
        !readOnly &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
          event.key,
        ) &&
        session.selection.length > 0
      ) {
        const distance = event.shiftKey ? 10 : 1
        const dx =
          event.key === 'ArrowLeft'
            ? -distance
            : event.key === 'ArrowRight'
              ? distance
              : 0
        const dy =
          event.key === 'ArrowUp'
            ? -distance
            : event.key === 'ArrowDown'
              ? distance
              : 0
        const operations: CanvasTransaction['operations'] = []
        for (const ref of rootSelection(
          engine.document,
          session.selection,
        )) {
          const node = resolveNodeRef(
            engine.document,
            ref,
            pageWidth,
          )
          if (!node || node.locked || node.layout.position !== 'absolute') {
            continue
          }
          const patch: NodePatch = {
            layout: {
              x: node.layout.x + dx,
              y: node.layout.y + dy,
            },
          }
          const instanceId = ref.instancePath.at(-1)
          operations.push(
            instanceId
              ? {
                  type: 'instance.patchOverride',
                  id: instanceId,
                  targetId: ref.nodeId,
                  patch,
                }
              : { type: 'node.patch', id: ref.nodeId, patch },
          )
        }
        if (operations.length > 0) {
          event.preventDefault()
          transact({
            id: canvasId('tx'),
            label: 'Nudge selection',
            coalesceKey: `nudge:${session.selection
              .map(refKey)
              .sort()
              .join(',')}`,
            operations,
          })
        }
        return
      }
      if (event.key === 'Escape') {
        const selected = session.selection[0]
        if (!selected) {
          session.setEditingRoot(null)
          return
        }
        const element = registry.get(selected)
        const parent = element?.parentElement?.closest('[data-loora-node]')
        const parentRef = parent ? parseNodeRef(parent) : null
        if (parentRef) session.select([parentRef])
        else session.select([])
        session.setEditingRoot(parentRef)
      }
      if (event.key === 'Enter') {
        const selected = session.selection[0]
        const node = selected ? engine.getNode(selected.nodeId) : null
        if (
          selected &&
          node &&
          (node.type === 'page' ||
            node.type === 'component' ||
            node.type === 'frame' ||
            node.type === 'group' ||
            node.type === 'instance')
        ) {
          session.setEditingRoot(selected)
        }
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      spaceHeld.current = false
      if (surfaceRef.current) {
        surfaceRef.current.style.cursor =
          interactionMode === 'pan' ? 'grab' : ''
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [
    engine,
    pageWidth,
    readOnly,
    redo,
    registry,
    session,
    transact,
    undo,
    interactionMode,
  ])
  useEffect(
    () =>
      session.subscribe(() => {
        onSelectionChange?.(session.selection)
      }),
    [onSelectionChange, session],
  )

  const schedule = (callback: () => void) => {
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      callback()
    })
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const scene = sceneRef.current
    if (!scene) return
    if (event.pointerType === 'touch') {
      pointers.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      })
      event.currentTarget.setPointerCapture(event.pointerId)
      if (pointers.current.size >= 2) {
        const entries = [...pointers.current.entries()].slice(0, 2)
        const [firstId, first] = entries[0]!
        const [secondId, second] = entries[1]!
        const surfaceRect = event.currentTarget.getBoundingClientRect()
        const midpointX = (first.x + second.x) / 2 - surfaceRect.left
        const midpointY = (first.y + second.y) / 2 - surfaceRect.top
        const distance = Math.max(
          1,
          Math.hypot(second.x - first.x, second.y - first.y),
        )
        const camera = cameraRef.current
        pinch.current = {
          ids: [firstId, secondId],
          distance,
          startZoom: camera.zoom,
          worldX: (midpointX - camera.x) / camera.zoom,
          worldY: (midpointY - camera.y) / camera.zoom,
        }
        drag.current = null
        pan.current = null
        marquee.current = null
        if (marqueeElementRef.current) {
          marqueeElementRef.current.style.display = 'none'
        }
        hideGuides()
        return
      }
    }
    if (
      event.button === 1 ||
      spaceHeld.current ||
      (event.button === 0 && interactionMode === 'pan')
    ) {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      pan.current = {
        x: event.clientX,
        y: event.clientY,
        cameraX: cameraRef.current.x,
        cameraY: cameraRef.current.y,
      }
      event.currentTarget.style.cursor = 'grabbing'
      return
    }
    if (event.button !== 0) return
    const current = session.selection[0] ?? null
    const selected = event.altKey
      ? cycleHit(event, scene, current)
      : chooseHit(event, scene, session, engine.document, current)
    if (!selected) {
      marquee.current = {
        x: event.clientX,
        y: event.clientY,
        latestX: event.clientX,
        latestY: event.clientY,
        additive: event.shiftKey,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      const overlay = marqueeElementRef.current
      const surfaceRect = event.currentTarget.getBoundingClientRect()
      if (overlay) {
        overlay.style.display = 'block'
        overlay.setAttribute('x', String(event.clientX - surfaceRect.left))
        overlay.setAttribute('y', String(event.clientY - surfaceRect.top))
        overlay.setAttribute('width', '0')
        overlay.setAttribute('height', '0')
      }
      if (!event.shiftKey) session.select([])
      return
    }
    // A press on the already-selected layer may be a drag or a click-to-drill.
    // Remember the candidate; pointer-up decides once movement is known.
    drill.current =
      !event.shiftKey && !event.altKey && current && sameRef(selected, current)
        ? {
            ref: drillHit(event, scene, current),
            x: event.clientX,
            y: event.clientY,
          }
        : null
    session.select(event.shiftKey && current ? [...session.selection, selected] : [selected])
    const element = registry.get(selected)
    const source = engine.getNode(selected.nodeId)
    if (
      !element ||
      !source ||
      readOnly ||
      source.locked ||
      element.getAttribute('data-loora-text-editing') === 'true'
    ) {
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    const startRect = element.getBoundingClientRect()
    const snapCandidates = registry
      .entries()
      .filter(({ ref, element: candidate }) => {
        if (
          sameRef(ref, selected) ||
          ref.instancePath.join('/') !== selected.instancePath.join('/') ||
          candidate.getAttribute('data-loora-locked') === 'true'
        ) {
          return false
        }
        return engine.getNode(ref.nodeId)?.parentId === source.parentId
      })
      .map(({ element: candidate }) => candidate.getBoundingClientRect())
    drag.current = {
      ref: selected,
      element,
      source,
      x: event.clientX,
      y: event.clientY,
      latestX: 0,
      latestY: 0,
      clientX: event.clientX,
      clientY: event.clientY,
      startRect,
      snapX: snapCandidates.flatMap((rect) => [
        rect.left,
        rect.left + rect.width / 2,
        rect.right,
      ]),
      snapY: snapCandidates.flatMap((rect) => [
        rect.top,
        rect.top + rect.height / 2,
        rect.bottom,
      ]),
      guideX: null,
      guideY: null,
      originalTransform: (element as HTMLElement).style.transform,
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' && pointers.current.has(event.pointerId)) {
      pointers.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      })
    }
    if (pinch.current) {
      const first = pointers.current.get(pinch.current.ids[0])
      const second = pointers.current.get(pinch.current.ids[1])
      if (!first || !second) return
      const surfaceRect = event.currentTarget.getBoundingClientRect()
      const midpointX = (first.x + second.x) / 2 - surfaceRect.left
      const midpointY = (first.y + second.y) / 2 - surfaceRect.top
      const distance = Math.max(
        1,
        Math.hypot(second.x - first.x, second.y - first.y),
      )
      const zoom = Math.min(
        4,
        Math.max(
          0.08,
          pinch.current.startZoom * (distance / pinch.current.distance),
        ),
      )
      cameraRef.current = {
        x: midpointX - pinch.current.worldX * zoom,
        y: midpointY - pinch.current.worldY * zoom,
        zoom,
      }
      schedule(applyCamera)
      return
    }
    if (marquee.current) {
      marquee.current.latestX = event.clientX
      marquee.current.latestY = event.clientY
      schedule(() => {
        const current = marquee.current
        const overlay = marqueeElementRef.current
        const surface = surfaceRef.current
        if (!current || !overlay || !surface) return
        const surfaceRect = surface.getBoundingClientRect()
        overlay.setAttribute(
          'x',
          String(Math.min(current.x, current.latestX) - surfaceRect.left),
        )
        overlay.setAttribute(
          'y',
          String(Math.min(current.y, current.latestY) - surfaceRect.top),
        )
        overlay.setAttribute(
          'width',
          String(Math.abs(current.latestX - current.x)),
        )
        overlay.setAttribute(
          'height',
          String(Math.abs(current.latestY - current.y)),
        )
      })
      return
    }
    if (pan.current) {
      cameraRef.current = {
        ...cameraRef.current,
        x: pan.current.cameraX + event.clientX - pan.current.x,
        y: pan.current.cameraY + event.clientY - pan.current.y,
      }
      schedule(applyCamera)
      return
    }
    if (!drag.current) return
    const activeDrag = drag.current
    const rawX = event.clientX - activeDrag.x
    const rawY = event.clientY - activeDrag.y
    const xSnap = nearestSnap(
      [
        activeDrag.startRect.left + rawX,
        activeDrag.startRect.left + activeDrag.startRect.width / 2 + rawX,
        activeDrag.startRect.right + rawX,
      ],
      activeDrag.snapX,
    )
    const ySnap = nearestSnap(
      [
        activeDrag.startRect.top + rawY,
        activeDrag.startRect.top + activeDrag.startRect.height / 2 + rawY,
        activeDrag.startRect.bottom + rawY,
      ],
      activeDrag.snapY,
    )
    activeDrag.latestX =
      (rawX + (xSnap?.delta ?? 0)) / cameraRef.current.zoom
    activeDrag.latestY =
      (rawY + (ySnap?.delta ?? 0)) / cameraRef.current.zoom
    activeDrag.clientX = event.clientX
    activeDrag.clientY = event.clientY
    activeDrag.guideX = xSnap?.position ?? null
    activeDrag.guideY = ySnap?.position ?? null
    schedule(() => {
      if (!drag.current) return
      ;(drag.current.element as HTMLElement).style.transform =
        `translate3d(${drag.current.latestX}px, ${drag.current.latestY}px, 0) ${drag.current.originalTransform}`
      overlaySyncRef.current?.(true)
      const surfaceRect = surfaceRef.current?.getBoundingClientRect()
      if (verticalGuideRef.current) {
        verticalGuideRef.current.style.display =
          drag.current.guideX === null ? 'none' : 'block'
        if (drag.current.guideX !== null && surfaceRect) {
          const x = drag.current.guideX - surfaceRect.left
          verticalGuideRef.current.setAttribute('x1', String(x))
          verticalGuideRef.current.setAttribute('x2', String(x))
        }
      }
      if (horizontalGuideRef.current) {
        horizontalGuideRef.current.style.display =
          drag.current.guideY === null ? 'none' : 'block'
        if (drag.current.guideY !== null && surfaceRect) {
          const y = drag.current.guideY - surfaceRect.top
          horizontalGuideRef.current.setAttribute('y1', String(y))
          horizontalGuideRef.current.setAttribute('y2', String(y))
        }
      }
    })
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    hideGuides()
    const pendingDrill = drill.current
    drill.current = null
    if (
      pendingDrill?.ref &&
      Math.abs(event.clientX - pendingDrill.x) < 3 &&
      Math.abs(event.clientY - pendingDrill.y) < 3
    ) {
      session.select([pendingDrill.ref])
    }
    if (event.pointerType === 'touch') {
      pointers.current.delete(event.pointerId)
      if (pinch.current) {
        if (pointers.current.size < 2) {
          pinch.current = null
          onCameraChange?.({ ...cameraRef.current })
        }
        return
      }
    }
    if (marquee.current) {
      const current = marquee.current
      marquee.current = null
      if (marqueeElementRef.current) {
        marqueeElementRef.current.style.display = 'none'
      }
      const left = Math.min(current.x, current.latestX)
      const right = Math.max(current.x, current.latestX)
      const top = Math.min(current.y, current.latestY)
      const bottom = Math.max(current.y, current.latestY)
      if (right - left < 3 && bottom - top < 3) {
        if (!current.additive) session.select([])
        return
      }
      const editingRoot = session.editingRoot
      const selected = registry
        .entries()
        .filter(({ element }) => {
          if (element.getAttribute('data-loora-locked') === 'true') return false
          const parent = element.parentElement?.closest('[data-loora-node]')
          const parentRef = parent ? parseNodeRef(parent) : null
          if (editingRoot ? !sameRef(parentRef, editingRoot) : !!parentRef) {
            return false
          }
          const rect = element.getBoundingClientRect()
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.left <= right &&
            rect.right >= left &&
            rect.top <= bottom &&
            rect.bottom >= top
          )
        })
        .map(({ ref }) => ref)
      const next = current.additive
        ? [...session.selection, ...selected].filter(
            (ref, index, all) =>
              all.findIndex((candidate) => sameRef(candidate, ref)) === index,
          )
        : selected
      session.select(next)
      return
    }
    if (pan.current) {
      pan.current = null
      event.currentTarget.style.cursor =
        spaceHeld.current || interactionMode === 'pan' ? 'grab' : ''
      onCameraChange?.({ ...cameraRef.current })
      return
    }
    const current = drag.current
    drag.current = null
    if (!current) return
    ;(current.element as HTMLElement).style.transform = current.originalTransform
    if (Math.abs(current.latestX) < 0.01 && Math.abs(current.latestY) < 0.01) return
    if (current.ref.instancePath.length === 0) {
      const target = document
        .elementsFromPoint(current.clientX, current.clientY)
        .filter(
          (element) =>
            element !== current.element &&
            !current.element.contains(element) &&
            element.hasAttribute('data-loora-node'),
        )
        .map((element) => ({
          element,
          ref: parseNodeRef(element),
        }))
        .find(({ ref }) => {
          if (!ref || ref.instancePath.length > 0 || ref.nodeId === current.source.id) {
            return false
          }
          const node = engine.getNode(ref.nodeId)
          if (!node || !['page', 'frame', 'group'].includes(node.type)) {
            return false
          }
          let parentId: NodeId | null = node.id
          while (parentId) {
            if (parentId === current.source.id) return false
            parentId = engine.getNode(parentId)?.parentId ?? null
          }
          return true
        })
      const targetNode = target?.ref
        ? engine.getNode(target.ref.nodeId)
        : null
      if (
        target?.ref &&
        targetNode &&
        targetNode.id !== current.source.parentId
      ) {
        const targetRect = target.element.getBoundingClientRect()
        const sourceRect = current.element.getBoundingClientRect()
        const absolute = targetNode.layout.mode === 'absolute'
        const layoutPatch: NodePatch = {
          layout: {
            position: absolute ? 'absolute' : 'flow',
            x: absolute
              ? (sourceRect.left +
                  current.latestX * cameraRef.current.zoom -
                  targetRect.left) /
                cameraRef.current.zoom
              : 0,
            y: absolute
              ? (sourceRect.top +
                  current.latestY * cameraRef.current.zoom -
                  targetRect.top) /
                cameraRef.current.zoom
              : 0,
          },
        }
        transact({
          id: canvasId('tx'),
          label: `Move ${current.source.name} into ${targetNode.name}`,
          preconditions: [
            ...preconditionsForNodeMove(engine.document, current.source.id),
            ...preconditionsForNodePatch(
              engine.document,
              current.source.id,
              layoutPatch,
            ),
          ],
          operations: [
            {
              type: 'node.move',
              id: current.source.id,
              parentId: targetNode.id,
              order:
                (engine.getChildren(targetNode.id).at(-1)?.order ?? 0) +
                1024,
            },
            {
              type: 'node.patch',
              id: current.source.id,
              patch: layoutPatch,
            },
          ],
        })
        return
      }
    }
    const patch: NodePatch = {
      layout: {
        position: 'absolute',
        x: current.source.layout.x + current.latestX,
        y: current.source.layout.y + current.latestY,
      },
    }
    const instanceId = current.ref.instancePath.at(-1)
    transact({
      id: canvasId('tx'),
      label: 'Move node',
      preconditions: instanceId
        ? undefined
        : preconditionsForNodePatch(engine.document, current.source.id, patch),
      operations: instanceId
        ? [{
            type: 'instance.patchOverride',
            id: instanceId,
            targetId: current.source.id,
            patch,
          }]
        : [{ type: 'node.patch', id: current.source.id, patch }],
    })
  }

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const camera = cameraRef.current
    if (event.metaKey || event.ctrlKey) {
      const rect = event.currentTarget.getBoundingClientRect()
      const pointerX = event.clientX - rect.left
      const pointerY = event.clientY - rect.top
      const nextZoom = Math.min(4, Math.max(0.08, camera.zoom * Math.exp(-event.deltaY * 0.002)))
      const worldX = (pointerX - camera.x) / camera.zoom
      const worldY = (pointerY - camera.y) / camera.zoom
      cameraRef.current = {
        x: pointerX - worldX * nextZoom,
        y: pointerY - worldY * nextZoom,
        zoom: nextZoom,
      }
    } else {
      cameraRef.current = {
        ...camera,
        x: camera.x - event.deltaX,
        y: camera.y - event.deltaY,
      }
    }
    schedule(() => {
      applyCamera()
      onCameraChange?.({ ...cameraRef.current })
    })
  }

  return (
    <div
      {...props}
      ref={surfaceRef}
      className={className}
      tabIndex={0}
      data-loora-canvas-surface
      data-loora-interaction-mode={interactionMode}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      style={{
        position: 'relative',
        overflow: 'hidden',
        touchAction: 'none',
        isolation: 'isolate',
        cursor: interactionMode === 'pan' ? 'grab' : undefined,
        backgroundColor: 'var(--cx-canvas, #f3f3f5)',
        ...style,
      } as CSSProperties}
    >
      <CanvasTokenStyles />
      <div
        ref={sceneRef}
        data-loora-canvas-scene
        style={{
          position: 'absolute',
          inset: 0,
          transformOrigin: '0 0',
          willChange: 'transform',
        }}
      >
        <RootNodes width={pageWidth} />
      </div>
      <SelectionOverlay
        sceneRef={sceneRef}
        cameraRef={cameraRef}
        syncRef={overlaySyncRef}
        marqueeRef={marqueeElementRef}
        verticalGuideRef={verticalGuideRef}
        horizontalGuideRef={horizontalGuideRef}
      />
    </div>
  )
}
