import {
  convertHtmlSnapshotToCanvas,
  type HtmlCanvasImportResult,
  type HtmlCanvasSnapshot,
} from '@loora/canvas/import'

export const MAX_HTML_IMPORT_SOURCE_BYTES = 1_000_000
export const MAX_CSS_IMPORT_SOURCE_BYTES = 500_000
export const MAX_HTML_IMPORT_ELEMENTS = 5_000

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
  'color',
  'box-shadow',
  'mix-blend-mode',
  'transform',
  'object-fit',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-decoration',
  'text-decoration-line',
  'text-transform',
  'flex-direction',
  'flex-wrap',
  'gap',
  'row-gap',
  'column-gap',
  'align-items',
  'justify-content',
  'grid-template-columns',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
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
    throw new Error('HTML import is larger than 1 MB')
  }
  if (byteLength(css) > MAX_CSS_IMPORT_SOURCE_BYTES) {
    throw new Error('CSS import is larger than 500 KB')
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
    "font-src data:",
    "img-src data: blob:",
    "style-src 'unsafe-inline'",
  ].join('; ')
  parsed.head.prepend(policy)

  const styles = parsed.createElement('style')
  styles.dataset.looraHtmlImport = 'true'
  const safeCss = css.replace(/<\/style/gi, '<\\/style')
  styles.textContent = `html,body{margin:0;min-height:100%;box-sizing:border-box}*,*::before,*::after{box-sizing:inherit}${safeCss}`
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
    styleProperties.map((property) => [
      camelCase(property),
      style.getPropertyValue(property),
    ]),
  )
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

function snapshotElement(element: Element): HtmlCanvasSnapshot | null {
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
  const children =
    directText
      ? []
      : [...element.childNodes]
          .map((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              return snapshotElement(node as Element)
            }
            if (node.nodeType === Node.TEXT_NODE) {
              return textSnapshot(node as Text, element, computed)
            }
            return null
          })
          .filter((child): child is HtmlCanvasSnapshot => !!child)

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

  try {
    const loaded = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error('HTML import sandbox timed out')),
        5_000,
      )
      iframe.addEventListener('load', () => {
        window.clearTimeout(timer)
        resolve()
      }, { once: true })
    })
    iframe.srcdoc = source
    await loaded
    const sandbox = iframe.contentDocument
    const view = iframe.contentWindow
    if (!sandbox?.body || !view) {
      throw new Error('HTML import sandbox could not be opened')
    }
    await Promise.race([
      sandbox.fonts?.ready ?? Promise.resolve(),
      new Promise<void>((resolve) => window.setTimeout(resolve, 1_000)),
    ])
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

    const body = snapshotElement(sandbox.body)
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
    iframe.remove()
  }
}
