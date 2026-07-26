import {
  type CanvasDocumentV2,
  type CanvasNode,
  type ComponentNode,
  type FrameNode,
  type ImageNode,
  type NodeId,
  type PageNode,
  type TextNode,
  canvasId,
  createCanvasDocument,
  createComponentNode,
  createFrameNode,
  createPageNode,
  createTextNode,
  defaultLayout,
  defaultStyle,
  DEFAULT_ORDER_STEP,
} from './model'

export interface LegacyCanvasElement {
  id: string
  name: string
  x: number
  y: number
  w: number
  h: number
  r?: number
  code: string
  hidden?: boolean
  locked?: boolean
}

export interface LegacyCanvasPage {
  id: string
  name: string
  x: number
  y: number
  w: number
  items: { id: string; elementId: string; height: number }[]
}

export interface LegacyDomNode {
  tag: string
  text?: string
  attributes: Record<string, string>
  style: Record<string, string>
  rect: { x: number; y: number; width: number; height: number }
  children: LegacyDomNode[]
  unsupported?: string[]
}

export interface LegacyRenderResult {
  root: LegacyDomNode | null
  png: string | null
  similarity?: number
  warnings?: string[]
}

export interface LegacyMigrationInput {
  id: string
  name: string
  elements: LegacyCanvasElement[]
  pages: LegacyCanvasPage[]
}

export interface LegacyMigrationReport {
  convertedElements: number
  rasterFallbacks: number
  warnings: string[]
  fallbackElementIds: string[]
}

export interface LegacyMigrationResult {
  document: CanvasDocumentV2
  report: LegacyMigrationReport
}

export interface LegacyMigrationOptions {
  render: (element: LegacyCanvasElement) => Promise<LegacyRenderResult>
  storeFallbackImage: (element: LegacyCanvasElement, png: string) => Promise<string>
  compare?: (input: {
    document: CanvasDocumentV2
    componentId: NodeId
    width: number
    height: number
    legacyPng: string
  }) => Promise<number>
  minimumSimilarity?: number
}

function numberStyle(style: Record<string, string>, name: string, fallback = 0) {
  const value = Number.parseFloat(style[name] ?? '')
  return Number.isFinite(value) ? value : fallback
}

function hasUnsupportedDom(node: LegacyDomNode): boolean {
  return (node.unsupported?.length ?? 0) > 0 || node.children.some(hasUnsupportedDom)
}

function domNodeToCanvas(
  dom: LegacyDomNode,
  parentId: NodeId,
  order: number,
  nodes: Record<NodeId, CanvasNode>,
  parentRect: LegacyDomNode['rect'],
): NodeId {
  const id = canvasId(dom.text && dom.children.length === 0 ? 'text' : 'frame')
  const x = dom.rect.x - parentRect.x
  const y = dom.rect.y - parentRect.y
  let node: CanvasNode
  if (dom.text && dom.children.length === 0) {
    const text: TextNode = createTextNode(dom.text, {
      id,
      parentId,
      order,
      layout: defaultLayout(dom.rect.width, dom.rect.height, {
        position: dom.style.position === 'absolute' ? 'absolute' : 'flow',
        x,
        y,
        height: { unit: 'hug' },
      }),
      style: defaultStyle({
        opacity: numberStyle(dom.style, 'opacity', 1),
        typography: {
          family: dom.style.fontFamily || 'Archivo',
          size: numberStyle(dom.style, 'fontSize', 16),
          weight: numberStyle(dom.style, 'fontWeight', 400),
          lineHeight: numberStyle(dom.style, 'lineHeight', 1.4),
          letterSpacing: numberStyle(dom.style, 'letterSpacing', 0),
          align:
            dom.style.textAlign === 'center' || dom.style.textAlign === 'right' || dom.style.textAlign === 'justify'
              ? dom.style.textAlign
              : 'left',
        },
      }),
    })
    node = text
  } else {
    const display = dom.style.display
    const frame: FrameNode = createFrameNode(dom.attributes['aria-label'] || dom.tag, {
      id,
      parentId,
      order,
      semanticTag:
        ['section', 'header', 'nav', 'main', 'footer', 'article', 'aside', 'button', 'a', 'form'].includes(dom.tag)
          ? (dom.tag as FrameNode['semanticTag'])
          : 'div',
      layout: defaultLayout(dom.rect.width, dom.rect.height, {
        position: dom.style.position === 'absolute' ? 'absolute' : 'flow',
        x,
        y,
        mode: display === 'flex' ? 'flex' : display === 'grid' ? 'grid' : 'absolute',
        direction: dom.style.flexDirection === 'column' ? 'column' : 'row',
        gap: numberStyle(dom.style, 'gap'),
        padding: {
          top: numberStyle(dom.style, 'paddingTop'),
          right: numberStyle(dom.style, 'paddingRight'),
          bottom: numberStyle(dom.style, 'paddingBottom'),
          left: numberStyle(dom.style, 'paddingLeft'),
        },
      }),
      style: defaultStyle({
        fills:
          dom.style.backgroundColor && dom.style.backgroundColor !== 'rgba(0, 0, 0, 0)'
            ? [{ type: 'solid', color: dom.style.backgroundColor }]
            : [],
        radius: numberStyle(dom.style, 'borderRadius'),
        opacity: numberStyle(dom.style, 'opacity', 1),
        overflow: dom.style.overflow === 'hidden' || dom.style.overflow === 'auto'
          ? dom.style.overflow
          : 'visible',
      }),
    })
    node = frame
  }
  nodes[id] = node
  dom.children.forEach((child, index) => {
    domNodeToCanvas(child, id, (index + 1) * DEFAULT_ORDER_STEP, nodes, dom.rect)
  })
  return id
}

export async function migrateLegacyCanvas(
  input: LegacyMigrationInput,
  options: LegacyMigrationOptions,
): Promise<LegacyMigrationResult> {
  const minimumSimilarity = options.minimumSimilarity ?? 0.98
  const document = createCanvasDocument(input.name, input.id)
  document.metadata.migratedFrom = 1
  const report: LegacyMigrationReport = {
    convertedElements: 0,
    rasterFallbacks: 0,
    warnings: [],
    fallbackElementIds: [],
  }
  const componentByLegacyId = new Map<string, NodeId>()

  for (const [index, element] of input.elements.entries()) {
    const rendered = await options.render(element)
    report.warnings.push(...(rendered.warnings ?? []).map((warning) => `${element.name}: ${warning}`))
    const componentId = canvasId('component')
    const component: ComponentNode = createComponentNode(element.name, {
        id: componentId,
        parentId: null,
        order: (index + 1) * DEFAULT_ORDER_STEP,
        layout: defaultLayout(element.w, element.h),
        variants: ['default'],
        defaultVariant: 'default',
      })
    document.nodes[componentId] = component
    componentByLegacyId.set(element.id, componentId)

    let useRaster =
      !rendered.root ||
      !rendered.png ||
      (rendered.similarity !== undefined && rendered.similarity < minimumSimilarity) ||
      (rendered.root ? hasUnsupportedDom(rendered.root) : false)
    let convertedRootId: NodeId | null = null
    if (!useRaster) {
      const root = rendered.root
      if (!root) throw new Error(`Legacy element ${element.id} did not produce a DOM snapshot`)
      convertedRootId = domNodeToCanvas(
        root,
        componentId,
        DEFAULT_ORDER_STEP,
        document.nodes,
        root.rect,
      )
      if (options.compare && rendered.png) {
        try {
          const similarity = await options.compare({
            document,
            componentId,
            width: element.w,
            height: element.h,
            legacyPng: rendered.png,
          })
          if (similarity < minimumSimilarity) {
            useRaster = true
            report.warnings.push(
              `${element.name}: visual similarity ${similarity.toFixed(3)} was below ${minimumSimilarity}`,
            )
          }
        } catch {
          useRaster = true
          report.warnings.push(`${element.name}: V2 visual comparison failed`)
        }
      }
    }
    if (useRaster) {
      if (!rendered.png) throw new Error(`Legacy element ${element.id} could not be captured`)
      if (convertedRootId) {
        const queue = [convertedRootId]
        while (queue.length > 0) {
          const id = queue.shift()!
          for (const child of Object.values(document.nodes)) {
            if (child.parentId === id) queue.push(child.id)
          }
          delete document.nodes[id]
        }
      }
      const src = await options.storeFallbackImage(element, rendered.png)
      const image: ImageNode = {
        id: canvasId('image'),
        type: 'image',
        name: `${element.name} migration fallback`,
        parentId: componentId,
        order: DEFAULT_ORDER_STEP,
        hidden: false,
        locked: false,
        rotation: 0,
        layout: defaultLayout(element.w, element.h, { position: 'flow' }),
        style: defaultStyle(),
        responsive: {},
        interactions: [],
        src,
        alt: element.name,
        fit: 'fill',
        metadata: { migrationFallback: true, legacyElementId: element.id },
      }
      document.nodes[image.id] = image
      report.rasterFallbacks += 1
      report.fallbackElementIds.push(element.id)
    } else {
      report.convertedElements += 1
    }

    const sourcePageId = `legacy-page-${element.id}`
    document.nodes[sourcePageId] = createPageNode(element.name, {
      id: sourcePageId,
      parentId: null,
      order: (input.elements.length + index + 1) * DEFAULT_ORDER_STEP,
      layout: defaultLayout(element.w, element.h, {
        x: element.x,
        y: element.y,
      }),
      viewport: { width: element.w, minHeight: element.h },
      metadata: { legacySourceElementId: element.id },
    })
    document.nodes[element.id] = {
      id: element.id,
      type: 'instance',
      name: element.name,
      parentId: sourcePageId,
      order: DEFAULT_ORDER_STEP,
      hidden: element.hidden ?? false,
      locked: element.locked ?? false,
      rotation: element.r ?? 0,
      layout: defaultLayout(element.w, element.h, {
        position: 'flow',
        x: 0,
        y: 0,
        width: { unit: 'fill' },
      }),
      style: defaultStyle({ overflow: 'hidden' }),
      responsive: {},
      interactions: [],
      componentId,
      overrides: {},
      metadata: { legacyElementId: element.id },
    }
  }

  for (const [pageIndex, legacyPage] of input.pages.entries()) {
    const page: PageNode = createPageNode(legacyPage.name, {
      id: legacyPage.id,
      parentId: null,
      order: (input.elements.length * 2 + pageIndex + 1) * DEFAULT_ORDER_STEP,
      layout: defaultLayout(
        legacyPage.w,
        legacyPage.items.reduce((height, item) => height + item.height, 0),
        { x: legacyPage.x, y: legacyPage.y, mode: 'flex', direction: 'column' },
      ),
      viewport: {
        width: legacyPage.w,
        minHeight: legacyPage.items.reduce((height, item) => height + item.height, 0),
      },
    })
    document.nodes[page.id] = page
    for (const [itemIndex, item] of legacyPage.items.entries()) {
      const componentId = componentByLegacyId.get(item.elementId)
      if (!componentId) {
        report.warnings.push(`${legacyPage.name}: missing legacy element ${item.elementId}`)
        continue
      }
      document.nodes[item.id] = {
        id: item.id,
        type: 'instance',
        name: input.elements.find((element) => element.id === item.elementId)?.name ?? 'Block',
        parentId: page.id,
        order: (itemIndex + 1) * DEFAULT_ORDER_STEP,
        hidden: false,
        locked: false,
        rotation: 0,
        layout: defaultLayout(legacyPage.w, item.height, {
          position: 'flow',
          width: { unit: 'fill' },
        }),
        style: defaultStyle({ overflow: 'hidden' }),
        responsive: {},
        interactions: [],
        componentId,
        overrides: {},
        metadata: { legacyPageItemId: item.id },
      }
    }
  }

  document.metadata.migrationWarnings = report.warnings
  return { document, report }
}

export function dataUrlToBlob(dataUrl: string) {
  const [header, encoded] = dataUrl.split(',', 2)
  const mediaType = header.match(/^data:([^;]+)/)?.[1] ?? 'image/png'
  const bytes = Uint8Array.from(atob(encoded ?? ''), (character) => character.charCodeAt(0))
  return new Blob([bytes], { type: mediaType })
}
