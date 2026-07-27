import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { CanvasEngine } from '@loora/canvas/engine'
import { renderElementToPng } from '@loora/canvas/export'
import { CanvasNodeRenderer, CanvasProvider } from '@loora/canvas/react'
import {
  createPageNode,
  defaultLayout,
  defaultStyle,
  type CanvasDocumentV2,
  type NodeRef,
  type PageNode,
} from '@loora/canvas/model'
import type { CanvasDomRegistry } from '@loora/canvas/react'

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

export interface CanvasCaptureOptions {
  pixelRatio?: number
  /** Images that could not be embedded, and so are missing from the capture. */
  onSkippedImage?: (src: string) => void
}

export async function elementToPng(
  element: HTMLElement | SVGElement,
  width = Math.max(1, Math.ceil(element.getBoundingClientRect().width)),
  height = Math.max(1, Math.ceil(element.getBoundingClientRect().height)),
  options: CanvasCaptureOptions = {},
) {
  return renderElementToPng(element, { width, height, ...options })
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Image could not be decoded'))
    image.src = src
  })
}

async function imagePixels(src: string, width: number, height: number) {
  const image = await loadImage(src)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Pixel comparison context is unavailable')
  context.drawImage(image, 0, 0, width, height)
  return context.getImageData(0, 0, width, height).data
}

export async function visualSimilarity(
  left: string,
  right: string,
  width: number,
  height: number,
) {
  const comparisonWidth = Math.max(1, Math.min(1440, Math.round(width)))
  const comparisonHeight = Math.max(1, Math.min(1440, Math.round(height)))
  const [leftPixels, rightPixels] = await Promise.all([
    imagePixels(left, comparisonWidth, comparisonHeight),
    imagePixels(right, comparisonWidth, comparisonHeight),
  ])
  let difference = 0
  for (let index = 0; index < leftPixels.length; index += 1) {
    difference += Math.abs(leftPixels[index]! - rightPixels[index]!)
  }
  return 1 - difference / (leftPixels.length * 255)
}

export async function renderComponentPng(
  source: CanvasDocumentV2,
  componentId: string,
  width: number,
  height: number,
) {
  const canvasDocument = structuredClone(source)
  const pageId = `migration-preview-page-${crypto.randomUUID()}`
  const instanceId = `migration-preview-instance-${crypto.randomUUID()}`
  canvasDocument.nodes[pageId] = createPageNode('Migration comparison', {
    id: pageId,
    parentId: null,
    order: Number.MAX_SAFE_INTEGER - 1,
    layout: defaultLayout(width, height),
    viewport: { width, minHeight: height },
  })
  canvasDocument.nodes[instanceId] = {
    id: instanceId,
    type: 'instance',
    name: 'Migration comparison',
    parentId: pageId,
    order: 1024,
    hidden: false,
    locked: false,
    rotation: 0,
    layout: defaultLayout(width, height, {
      position: 'flow',
      width: { unit: 'fill' },
    }),
    style: defaultStyle({ overflow: 'hidden' }),
    responsive: {},
    interactions: [],
    componentId,
    overrides: {},
  }
  const host = globalThis.document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-100000px'
  host.style.top = '0'
  host.style.width = `${width}px`
  host.style.height = `${height}px`
  host.style.pointerEvents = 'none'
  globalThis.document.body.appendChild(host)
  const root = createRoot(host)
  try {
    root.render(
      createElement(
        CanvasProvider,
        {
          engine: new CanvasEngine(canvasDocument),
          children: createElement(CanvasNodeRenderer, {
            id: pageId,
            width,
          }),
        },
      ),
    )
    await nextFrame()
    await nextFrame()
    await globalThis.document.fonts?.ready
    const page = host.querySelector<HTMLElement>(`[data-loora-node="${CSS.escape(pageId)}"]`)
    if (!page) throw new Error('Migration preview did not render')
    return elementToPng(page, width, height)
  } finally {
    root.unmount()
    host.remove()
  }
}

export async function renderPagePng(
  source: CanvasDocumentV2,
  pageId: string,
  width: number,
) {
  const canvasDocument = structuredClone(source)
  const page = canvasDocument.nodes[pageId]
  if (!page || page.type !== 'page') {
    throw new Error(`Page "${pageId}" does not exist`)
  }
  const height = Math.max(
    1,
    page.layout.height.unit === 'px'
      ? page.layout.height.value
      : page.viewport.minHeight,
  )
  page.layout = {
    ...page.layout,
    x: 0,
    y: 0,
    width: { unit: 'px', value: width },
  }
  page.viewport = {
    ...page.viewport,
    width,
  }

  const host = globalThis.document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-100000px'
  host.style.top = '0'
  host.style.width = `${width}px`
  host.style.height = `${height}px`
  host.style.pointerEvents = 'none'
  globalThis.document.body.appendChild(host)
  const root = createRoot(host)
  try {
    root.render(
      createElement(
        CanvasProvider,
        {
          engine: new CanvasEngine(canvasDocument),
          children: createElement(CanvasNodeRenderer, {
            id: pageId,
            width,
            topLevel: true,
          }),
        },
      ),
    )
    await nextFrame()
    await nextFrame()
    await globalThis.document.fonts?.ready
    const rendered = host.querySelector<HTMLElement>(
      `[data-loora-node="${CSS.escape(pageId)}"][data-loora-instance-path=""]`,
    )
    if (!rendered) throw new Error('Responsive Page preview did not render')
    const outputHeight = Math.max(
      1,
      Math.ceil(rendered.getBoundingClientRect().height),
      rendered.scrollHeight,
    )
    host.style.height = `${outputHeight}px`
    return elementToPng(rendered, width, outputHeight)
  } finally {
    root.unmount()
    host.remove()
  }
}

export async function captureNodePng(
  registry: CanvasDomRegistry,
  ref: NodeRef,
  options: CanvasCaptureOptions = {},
) {
  const element = registry.get(ref)
  if (!element) throw new Error('The node is not currently rendered')
  const bounds = element.getBoundingClientRect()
  return elementToPng(
    element,
    Math.max(1, Math.ceil(bounds.width)),
    Math.max(1, Math.ceil(bounds.height)),
    options,
  )
}

export async function captureCanvasPng(
  canvasDocument: CanvasDocumentV2,
  registry: CanvasDomRegistry,
  options: CanvasCaptureOptions = {},
) {
  const pages = Object.values(canvasDocument.nodes)
    .filter((node): node is PageNode => node.type === 'page' && !node.hidden)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .slice(0, 8)
  if (pages.length === 0) throw new Error('The canvas has no visible Pages')
  const minX = Math.min(...pages.map((page) => page.layout.x))
  const minY = Math.min(...pages.map((page) => page.layout.y))
  const maxX = Math.max(
    ...pages.map((page) => {
      const width =
        page.layout.width.unit === 'px'
          ? page.layout.width.value
          : page.viewport.width
      return page.layout.x + width
    }),
  )
  const maxY = Math.max(
    ...pages.map((page) => {
      const height =
        page.layout.height.unit === 'px'
          ? page.layout.height.value
          : page.viewport.minHeight
      return page.layout.y + height
    }),
  )
  const naturalWidth = Math.max(1, maxX - minX)
  const naturalHeight = Math.max(1, maxY - minY)
  const scale = Math.min(1, 3_840 / naturalWidth, 3_840 / naturalHeight)
  const outputWidth = Math.max(1, Math.round(naturalWidth * scale))
  const outputHeight = Math.max(1, Math.round(naturalHeight * scale))
  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-100000px'
  host.style.top = '0'
  host.style.width = `${outputWidth}px`
  host.style.height = `${outputHeight}px`
  host.style.overflow = 'hidden'
  host.style.background = '#edeaf2'
  const scene = document.createElement('div')
  scene.style.position = 'relative'
  scene.style.width = `${naturalWidth}px`
  scene.style.height = `${naturalHeight}px`
  scene.style.transform = `scale(${scale})`
  scene.style.transformOrigin = 'top left'
  host.appendChild(scene)
  for (const page of pages) {
    const rendered = registry.get({ nodeId: page.id, instancePath: [] })
    if (!rendered) continue
    const clone = rendered.cloneNode(true) as HTMLElement
    clone.style.position = 'absolute'
    clone.style.left = `${page.layout.x - minX}px`
    clone.style.top = `${page.layout.y - minY}px`
    clone.style.transform = `rotate(${page.rotation}deg)`
    scene.appendChild(clone)
  }
  document.body.appendChild(host)
  try {
    return await elementToPng(host, outputWidth, outputHeight, options)
  } finally {
    host.remove()
  }
}
