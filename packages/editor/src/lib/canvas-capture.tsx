import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { CanvasEngine } from '@loora/canvas/engine'
import { renderElementToPng } from '@loora/canvas/export'
import { CanvasNodeRenderer, CanvasProvider } from '@loora/canvas/react'
import {
  type CanvasDocument,
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

export async function renderPagePng(
  source: CanvasDocument,
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
  canvasDocument: CanvasDocument,
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
