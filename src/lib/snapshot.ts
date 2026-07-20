import type { CanvasElement } from './canvas'
import {
  captureElement,
  getElementCaptureRevision,
  type ElementCapture,
} from '#/components/element-frame'
import { CaptureCache, shouldReuseCapture } from './snapshot-cache'

// Cache the latest successful capture per element, keyed by its code and
// size, so snapshots reuse PNGs for unchanged elements and have a fallback
// while an iframe is booting.
interface CaptureCacheEntry extends ElementCapture {
  key: string
  image: HTMLImageElement
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
      captureCache.set(el.id, { key, image, ...capture })
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
  }: { pixelRatio?: number; freshness?: 'reuse-clean' | 'fresh' } = {},
): Promise<string | null> {
  if (elements.length === 0) return null

  const pad = 40
  const minX = Math.min(...elements.map((el) => el.x)) - pad
  const minY = Math.min(...elements.map((el) => el.y)) - pad
  const maxX = Math.max(...elements.map((el) => el.x + el.w)) + pad
  const maxY = Math.max(...elements.map((el) => el.y + el.h)) + pad
  const w = maxX - minX
  const h = maxY - minY
  const scale = Math.min(1, 1600 / Math.max(w, h)) * pixelRatio

  const shots = await Promise.all(
    elements.map(async (el) => {
      const img = await elementShot(el, freshness)
      return { el, img }
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
    }
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}
