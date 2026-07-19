import type { CanvasElement } from './canvas'
import { captureElement } from '#/components/element-frame'

// Cache the latest successful capture per element, keyed by its code and
// size, so snapshots reuse PNGs for unchanged elements and have a fallback
// while an iframe is booting.
const captureCache = new Map<string, { key: string; png: string }>()

function cacheKey(el: CanvasElement) {
  // djb2 over the code keeps the key short without hashing dependencies.
  let hash = 5381
  for (let i = 0; i < el.code.length; i++) hash = ((hash << 5) + hash + el.code.charCodeAt(i)) | 0
  return `${hash}:${el.w}:${el.h}`
}

async function elementShot(el: CanvasElement): Promise<string | null> {
  const key = cacheKey(el)
  const png = await captureElement(el.id)
  if (png) {
    captureCache.set(el.id, { key, png })
    return png
  }
  const cached = captureCache.get(el.id)
  return cached?.key === key ? cached.png : null
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
  { pixelRatio = 1 }: { pixelRatio?: number } = {},
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
      const png = await elementShot(el)
      return { el, img: png ? await loadImage(png) : null }
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
