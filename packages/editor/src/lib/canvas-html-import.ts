import {
  convertHtmlSnapshotToCanvas,
  type HtmlCanvasImportResult,
  type HtmlCanvasSnapshot,
} from '@loora/canvas/import'

/** Paper snapshots often embed images as data URLs; 1 MB was too tight. */
export const MAX_HTML_IMPORT_SOURCE_BYTES = 8_000_000
export const MAX_CSS_IMPORT_SOURCE_BYTES = 2_000_000
export const MAX_HTML_IMPORT_ELEMENTS = 20_000

function formatByteLimit(bytes: number) {
  if (bytes >= 1_000_000 && bytes % 1_000_000 === 0) {
    return `${bytes / 1_000_000} MB`
  }
  if (bytes >= 1_000 && bytes % 1_000 === 0) {
    return `${bytes / 1_000} KB`
  }
  return `${bytes.toLocaleString()} bytes`
}

export interface HtmlCssImportInput {
  html: string
  css?: string
  name?: string
  width?: number
  height?: number
}

const removedElements = [
  'script',
  'noscript',
  'iframe',
  'frame',
  'object',
  'embed',
  'portal',
  'link',
  'base',
]

const textElements = new Set([
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

const styleProperties = [
  'display',
  'position',
  'width',
  'height',
  'opacity',
  'overflow',
  'overflow-x',
  'overflow-y',
  'background-color',
  'background-image',
  'background-size',
  'background-position',
  'color',
  'box-shadow',
  'mix-blend-mode',
  'transform',
  'object-fit',
  'aspect-ratio',
  'fill',
  'stroke',
  'stroke-width',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-decoration',
  'text-decoration-line',
  'text-transform',
  'white-space',
  'text-wrap-mode',
  'flex-direction',
  'flex-wrap',
  'gap',
  'row-gap',
  'column-gap',
  'align-items',
  'justify-content',
  'grid-template-columns',
  'filter',
  'clip-path',
  'mask-image',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
] as const

const colorStyleProperties = new Set([
  'backgroundColor',
  'color',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'fill',
  'stroke',
])

let colorNormalizerCanvas: HTMLCanvasElement | null = null

function normalizeSnapshotColor(value: string) {
  if (!value || value === 'transparent') return value
  if (
    /^#[0-9a-f]{3,8}$/i.test(value) ||
    /^(?:rgb|rgba|hsl|hsla)\(/i.test(value)
  ) {
    return value
  }
  try {
    colorNormalizerCanvas ??= document.createElement('canvas')
    const context = colorNormalizerCanvas.getContext('2d')
    if (!context) return value
    context.fillStyle = '#000000'
    context.fillStyle = value
    const resolved = context.fillStyle
    if (resolved && resolved !== '#000000') return resolved
    context.fillStyle = '#ffffff'
    context.fillStyle = value
    if (context.fillStyle !== '#ffffff') return context.fillStyle
    // Genuine black / unresolved — keep original for import-side parsing.
    return value
  } catch {
    return value
  }
}

function camelCase(value: string) {
  return value.replace(/-([a-z])/g, (_, character: string) =>
    character.toUpperCase(),
  )
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).length
}

/**
 * Build the exact document loaded into the import sandbox. It is exported so
 * the security boundary can be unit tested without laying out an iframe.
 */
export function buildHtmlImportDocument(html: string, css = '') {
  if (byteLength(html) > MAX_HTML_IMPORT_SOURCE_BYTES) {
    throw new Error(
      `HTML import is larger than ${formatByteLimit(MAX_HTML_IMPORT_SOURCE_BYTES)}`,
    )
  }
  if (byteLength(css) > MAX_CSS_IMPORT_SOURCE_BYTES) {
    throw new Error(
      `CSS import is larger than ${formatByteLimit(MAX_CSS_IMPORT_SOURCE_BYTES)}`,
    )
  }
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  if (parsed.querySelectorAll('*').length > MAX_HTML_IMPORT_ELEMENTS) {
    throw new Error(
      `HTML import exceeds the ${MAX_HTML_IMPORT_ELEMENTS.toLocaleString()} element limit`,
    )
  }
  for (const selector of removedElements) {
    parsed.querySelectorAll(selector).forEach((element) => element.remove())
  }
  parsed
    .querySelectorAll('meta[http-equiv]')
    .forEach((element) => element.remove())
  for (const element of parsed.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (
        attribute.name.toLowerCase().startsWith('on') ||
        attribute.name.toLowerCase() === 'srcdoc'
      ) {
        element.removeAttribute(attribute.name)
      }
    }
  }

  const policy = parsed.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content = [
    "default-src 'none'",
    "script-src 'none'",
    "connect-src 'none'",
    "frame-src 'none'",
    "media-src 'none'",
    // Paper pastes need remote webfonts and product images to measure correctly.
    "font-src https: data:",
    "img-src https: data: blob:",
    "style-src 'unsafe-inline'",
  ].join('; ')
  parsed.head.prepend(policy)

  const styles = parsed.createElement('style')
  styles.dataset.looraHtmlImport = 'true'
  const safeCss = css.replace(/<\/style/gi, '<\\/style')
  styles.textContent = `html,body{margin:0;min-height:100%;box-sizing:border-box}*,*::before,*::after{box-sizing:inherit}x-paper-html{display:inline-block}${safeCss}`
  parsed.head.appendChild(styles)
  return `<!doctype html>${parsed.documentElement.outerHTML}`
}

function rect(value: DOMRect | { x: number; y: number; width: number; height: number }) {
  return {
    x: Number.isFinite(value.x) ? value.x : 0,
    y: Number.isFinite(value.y) ? value.y : 0,
    width: Number.isFinite(value.width) ? value.width : 0,
    height: Number.isFinite(value.height) ? value.height : 0,
  }
}

function styleSnapshot(style: CSSStyleDeclaration) {
  return Object.fromEntries(
    styleProperties.map((property) => {
      const key = camelCase(property)
      let value = style.getPropertyValue(property)
      if (colorStyleProperties.has(key)) {
        value = normalizeSnapshotColor(value)
      }
      return [key, value]
    }),
  )
}

function hasGeneratedPseudo(view: Window, element: Element) {
  for (const pseudo of ['::before', '::after'] as const) {
    try {
      const style = view.getComputedStyle(element, pseudo)
      const content = style.content
      if (
        content &&
        content !== 'none' &&
        content !== 'normal' &&
        content !== '""' &&
        content !== "''"
      ) {
        return true
      }
    } catch {
      // Some environments reject pseudo lookups.
    }
  }
  return false
}

function needsRasterFallback(
  element: Element,
  style: CSSStyleDeclaration,
  view: Window,
) {
  const tag = element.tagName.toLowerCase()
  if (tag === 'svg') {
    const hasPathLike = !!element.querySelector(
      'path[d], circle, ellipse, rect, line, polyline, polygon',
    )
    if (!hasPathLike) return true
  }
  if (style.filter && style.filter !== 'none') return true
  if (style.clipPath && style.clipPath !== 'none') return true
  if (style.maskImage && style.maskImage !== 'none') return true
  if (hasGeneratedPseudo(view, element)) return true
  return false
}

async function rasterizeElement(element: Element): Promise<string | null> {
  const bounds = element.getBoundingClientRect()
  const width = Math.ceil(bounds.width)
  const height = Math.ceil(bounds.height)
  if (width < 1 || height < 1) return null

  if (element instanceof SVGSVGElement) {
    try {
      const clone = element.cloneNode(true) as SVGSVGElement
      if (!clone.getAttribute('xmlns')) {
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      }
      const xml = new XMLSerializer().serializeToString(clone)
      const url = URL.createObjectURL(
        new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }),
      )
      try {
        const image = new Image()
        image.decoding = 'async'
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve()
          image.onerror = () => reject(new Error('svg raster failed'))
          image.src = url
        })
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) return null
        context.drawImage(image, 0, 0, width, height)
        return canvas.toDataURL('image/png')
      } finally {
        URL.revokeObjectURL(url)
      }
    } catch {
      return null
    }
  }

  // Generic HTML: serialize into an SVG foreignObject and paint.
  try {
    const clone = element.cloneNode(true) as HTMLElement
    const serialized = new XMLSerializer().serializeToString(clone)
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;margin:0">
            ${serialized}
          </div>
        </foreignObject>
      </svg>
    `
    const url = URL.createObjectURL(
      new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
    )
    try {
      const image = new Image()
      image.decoding = 'async'
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('html raster failed'))
        image.src = url
      })
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) return null
      context.drawImage(image, 0, 0, width, height)
      return canvas.toDataURL('image/png')
    } finally {
      URL.revokeObjectURL(url)
    }
  } catch {
    return null
  }
}

function textValue(node: Text, style: CSSStyleDeclaration) {
  const value = node.data.replace(/\r\n?/g, '\n')
  if (style.whiteSpace.startsWith('pre')) return value
  return value.replace(/\s+/g, ' ').trim()
}

function textSnapshot(
  node: Text,
  parent: Element,
  style: CSSStyleDeclaration,
): HtmlCanvasSnapshot | null {
  const text = textValue(node, style)
  if (!text) return null
  const range = node.ownerDocument.createRange()
  range.selectNodeContents(node)
  const measured =
    typeof range.getBoundingClientRect === 'function'
      ? range.getBoundingClientRect()
      : parent.getBoundingClientRect()
  range.detach()
  const parentRect = parent.getBoundingClientRect()
  const bounds =
    measured.width > 0 || measured.height > 0 ? measured : parentRect
  return {
    tag: '#text',
    text,
    attributes: {},
    style: styleSnapshot(style),
    rect: rect(bounds),
    children: [],
  }
}

function elementAttributes(element: Element) {
  const attributes = Object.fromEntries(
    [...element.attributes].map((attribute) => [
      attribute.name,
      attribute.value,
    ]),
  )
  if (element instanceof HTMLImageElement) {
    attributes.src = element.currentSrc || element.src
  }
  if (element instanceof HTMLAnchorElement) {
    attributes.href = element.href
  }
  return attributes
}

async function snapshotElement(
  element: Element,
): Promise<HtmlCanvasSnapshot | null> {
  const view = element.ownerDocument.defaultView
  if (!view) return null
  const computed = view.getComputedStyle(element)
  if (
    computed.display === 'none' ||
    computed.visibility === 'hidden' ||
    computed.contentVisibility === 'hidden'
  ) {
    return null
  }
  const bounds = element.getBoundingClientRect()
  const tag = element.tagName.toLowerCase()

  if (needsRasterFallback(element, computed, view)) {
    const rasterDataUrl = await rasterizeElement(element)
    if (rasterDataUrl) {
      return {
        tag,
        attributes: elementAttributes(element),
        style: styleSnapshot(computed),
        rect: rect(bounds),
        children: [],
        rasterDataUrl,
      }
    }
  }

  const elementChildren = [...element.children].filter(
    (child) => view.getComputedStyle(child).display !== 'none',
  )
  const directText =
    elementChildren.length === 0 && textElements.has(tag)
      ? [...element.childNodes]
          .filter((node): node is Text => node.nodeType === Node.TEXT_NODE)
          .map((node) => textValue(node, computed))
          .join(' ')
          .trim()
      : ''
  const children: HtmlCanvasSnapshot[] = []
  if (!directText) {
    for (const node of element.childNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const child = await snapshotElement(node as Element)
        if (child) children.push(child)
      } else if (node.nodeType === Node.TEXT_NODE) {
        const child = textSnapshot(node as Text, element, computed)
        if (child) children.push(child)
      }
    }
  }

  if (
    bounds.width <= 0 &&
    bounds.height <= 0 &&
    !directText &&
    children.length === 0
  ) {
    return null
  }
  return {
    tag,
    ...(directText ? { text: directText } : {}),
    attributes: elementAttributes(element),
    style: styleSnapshot(computed),
    rect: rect(bounds),
    children,
  }
}

function nextFrame(view: Window) {
  return new Promise<void>((resolve) => view.requestAnimationFrame(() => resolve()))
}

/**
 * An image that has not decoded yet measures as an empty box, and an empty box
 * is either dropped or captured at the wrong size. Broken sources settle too —
 * `decode` rejects for them — so this waits for an answer either way, and the
 * timeout keeps one stalled response from holding up the whole import.
 */
function settleImages(sandbox: Document, budgetMs: number) {
  const pending = [...sandbox.images].filter((image) => !image.complete)
  if (pending.length === 0) return Promise.resolve()
  return Promise.race([
    Promise.allSettled(pending.map((image) => image.decode())),
    new Promise<void>((resolve) => window.setTimeout(resolve, budgetMs)),
  ]).then(() => undefined)
}

/**
 * Large Paper snapshots blow past practical `srcdoc` sizes in Chromium. A blob
 * URL keeps the same sandboxed document while staying reliable at multi-MB.
 */
function loadSandboxDocument(iframe: HTMLIFrameElement, source: string) {
  const bytes = byteLength(source)
  const loadBudgetMs = Math.min(30_000, Math.max(5_000, 5_000 + bytes / 2_000))
  const objectUrl = URL.createObjectURL(
    new Blob([source], { type: 'text/html;charset=utf-8' }),
  )
  const loaded = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error('HTML import sandbox timed out')),
      loadBudgetMs,
    )
    iframe.addEventListener(
      'load',
      () => {
        window.clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
  iframe.src = objectUrl
  return {
    loaded,
    revoke: () => URL.revokeObjectURL(objectUrl),
  }
}

export async function importHtmlCssToCanvas(
  input: HtmlCssImportInput,
): Promise<HtmlCanvasImportResult> {
  const html = input.html.trim()
  if (!html) throw new Error('Paste some HTML to import')
  const requestedWidth = Number.isFinite(input.width) ? input.width! : 1_440
  const requestedHeight = Number.isFinite(input.height) ? input.height! : 900
  const width = Math.min(10_000, Math.max(1, requestedWidth))
  const minimumHeight = Math.min(20_000, Math.max(1, requestedHeight))
  const source = buildHtmlImportDocument(html, input.css)
  const iframe = document.createElement('iframe')
  iframe.title = 'HTML import sandbox'
  iframe.sandbox.add('allow-same-origin')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = [
    'position:fixed',
    'left:-100000px',
    'top:0',
    `width:${width}px`,
    `height:${minimumHeight}px`,
    'border:0',
    'pointer-events:none',
    'opacity:0',
  ].join(';')
  document.body.appendChild(iframe)
  const { loaded, revoke } = loadSandboxDocument(iframe, source)

  try {
    await loaded
    const sandbox = iframe.contentDocument
    const view = iframe.contentWindow
    if (!sandbox?.body || !view) {
      throw new Error('HTML import sandbox could not be opened')
    }
    const imageBudgetMs = Math.min(
      8_000,
      Math.max(1_500, 1_500 + sandbox.images.length * 250),
    )
    await Promise.race([
      sandbox.fonts?.ready ?? Promise.resolve(),
      new Promise<void>((resolve) => window.setTimeout(resolve, 3_000)),
    ])
    await settleImages(sandbox, imageBudgetMs)
    await nextFrame(view)
    await nextFrame(view)

    const height = Math.min(
      20_000,
      Math.max(
        minimumHeight,
        sandbox.body.scrollHeight,
        sandbox.documentElement.scrollHeight,
      ),
    )
    iframe.style.height = `${height}px`
    await nextFrame(view)

    const body = await snapshotElement(sandbox.body)
    if (!body) throw new Error('The HTML did not produce visible content')
    body.rect = { x: 0, y: 0, width, height }
    return convertHtmlSnapshotToCanvas({
      id: `html_${crypto.randomUUID().replaceAll('-', '')}`,
      name: input.name?.trim() || 'Imported HTML',
      width,
      height,
      root: body,
    })
  } finally {
    revoke()
    iframe.remove()
  }
}
