import type { CanvasElement, CanvasPage } from './canvas'
import { visibleElements } from './canvas'
import {
  captureElement,
  getElementCaptureRevision,
  type ElementCapture,
} from '#/components/element-frame'
import { CaptureCache, shouldReuseCapture } from './snapshot-cache'
import { elementAABB } from './snap'
import { pageElements, pageHeight } from './pages'

// Cache the latest successful capture per element, keyed by its code and
// size, so snapshots reuse PNGs for unchanged elements and have a fallback
// while an iframe is booting.
interface CaptureCacheEntry extends ElementCapture {
  key: string
  image: HTMLImageElement
  at: number
}

const MAX_CAPTURE_CACHE = 256
const captureCache = new CaptureCache<CaptureCacheEntry>(MAX_CAPTURE_CACHE)

function cacheKey(el: CanvasElement) {
  // djb2 over the code keeps the key short without hashing dependencies.
  let hash = 5381
  for (let i = 0; i < el.code.length; i++) hash = ((hash << 5) + hash + el.code.charCodeAt(i)) | 0
  return `${hash}:${el.w}:${el.h}`
}

async function elementShot(
  el: CanvasElement,
  freshness: 'reuse-clean' | 'fresh',
): Promise<HTMLImageElement | null> {
  const key = cacheKey(el)
  const cached = captureCache.get(el.id)
  if (cached && shouldReuseCapture(cached, key, getElementCaptureRevision(el.id), freshness)) {
    return cached.image
  }

  const capture = await captureElement(el.id)
  if (capture) {
    const image = await loadImage(capture.png)
    if (image) {
      captureCache.set(el.id, { key, image, at: Date.now(), ...capture })
      return image
    }
  }

  // A failed fresh capture may still use the latest image for the same code
  // and size, but never a capture belonging to different element contents.
  return cached?.key === key ? cached.image : null
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

// Composite the live element iframes' self-captures onto one PNG data URL
// (agent snapshots and file export).
export async function snapshotCanvas(
  elements: CanvasElement[],
  {
    pixelRatio = 1,
    freshness = 'reuse-clean',
    pages = [],
  }: {
    pixelRatio?: number
    freshness?: 'reuse-clean' | 'fresh'
    pages?: CanvasPage[]
  } = {},
): Promise<string | null> {
  // Hidden elements have no frame to capture and are not what the user sees,
  // so they must not reach the agent's snapshot either.
  elements = visibleElements(elements)
  if (elements.length === 0 && pages.length === 0) return null

  const pad = 40
  const boxes = [
    ...elements.map(elementAABB),
    ...pages.map((page) => ({
      left: page.x,
      top: page.y,
      right: page.x + page.w,
      bottom: page.y + Math.max(192, pageHeight(page)),
    })),
  ]
  const minX = Math.min(...boxes.map((b) => b.left)) - pad
  const minY = Math.min(...boxes.map((b) => b.top)) - pad
  const maxX = Math.max(...boxes.map((b) => b.right)) + pad
  const maxY = Math.max(...boxes.map((b) => b.bottom)) + pad
  const w = maxX - minX
  const h = maxY - minY
  const scale = Math.min(1, 1600 / Math.max(w, h)) * pixelRatio

  const shots = await Promise.all(
    elements.map(async (el) => {
      const img = await elementShot(el, freshness)
      return { el, img }
    }),
  )
  const pageShots = await Promise.all(
    pages.map(async (page) => {
      const png = await snapshotPage(page, elements)
      return { page, image: png ? await loadImage(png) : null }
    }),
  )

  try {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#f1f0ec'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Array order is z-order.
    for (const { el, img } of shots) {
      const x = (el.x - minX) * scale
      const y = (el.y - minY) * scale
      const ew = el.w * scale
      const eh = el.h * scale
      const rotated = (el.r ?? 0) % 360 !== 0
      if (rotated) {
        ctx.save()
        ctx.translate(x + ew / 2, y + eh / 2)
        ctx.rotate(((el.r ?? 0) * Math.PI) / 180)
        ctx.translate(-(x + ew / 2), -(y + eh / 2))
      }
      if (img) {
        ctx.drawImage(img, x, y, ew, eh)
      } else {
        // Not mounted or capture failed: labeled placeholder.
        ctx.fillStyle = '#e5e3dc'
        ctx.fillRect(x, y, ew, eh)
        ctx.fillStyle = '#75726b'
        ctx.font = `${Math.max(10, 12 * scale)}px monospace`
        ctx.fillText(el.name || 'Element', x + 8, y + 18, Math.max(20, ew - 16))
      }
      if (rotated) ctx.restore()
    }
    for (const { page, image } of pageShots) {
      const x = (page.x - minX) * scale
      const y = (page.y - minY) * scale
      const pageWidth = page.w * scale
      const pageCanvasHeight = Math.max(192, pageHeight(page)) * scale
      if (image) {
        ctx.fillStyle = '#fff'
        ctx.fillRect(x, y, pageWidth, pageCanvasHeight)
        ctx.drawImage(
          image,
          x,
          y,
          pageWidth,
          pageHeight(page) * scale,
        )
      } else {
        ctx.fillStyle = '#e5e3dc'
        ctx.fillRect(x, y, pageWidth, pageCanvasHeight)
        ctx.fillStyle = '#75726b'
        ctx.font = `${Math.max(10, 12 * scale)}px monospace`
        ctx.fillText(page.name || 'Page', x + 8, y + 18, Math.max(20, pageWidth - 16))
      }
    }
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

export async function snapshotPage(
  page: CanvasPage,
  elements: CanvasElement[],
  { pixelRatio = 1 }: { pixelRatio?: number } = {},
): Promise<string | null> {
  const resolved = pageElements(page, elements)
  if (resolved.some(({ element }) => !element || element.hidden)) return null
  const height = pageHeight(page)
  const scale = Math.min(1, 1600 / Math.max(page.w, height)) * pixelRatio
  const captures = await Promise.all(
    resolved.map(async ({ item, element }) => {
      const capture =
        (await captureElement(`canvas-page:${page.id}:${item.id}`)) ??
        (await captureElement(element!.id))
      return { item, image: capture ? await loadImage(capture.png) : null }
    }),
  )

  try {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(page.w * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')!
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    let top = 0
    for (const { item, image } of captures) {
      const itemHeight = item.height * scale
      if (image) context.drawImage(image, 0, top, canvas.width, itemHeight)
      else {
        context.fillStyle = '#e5e3dc'
        context.fillRect(0, top, canvas.width, itemHeight)
      }
      top += itemHeight
    }
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}
