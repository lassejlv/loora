import type { Shape } from './canvas'
import { renderOrder } from './canvas'

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function shapeSvg(s: Shape): string {
  const opacity = s.opacity != null ? ` opacity="${s.opacity}"` : ''
  const stroke = s.stroke
    ? ` stroke="${esc(s.stroke)}" stroke-width="${s.strokeWidth ?? 1}"`
    : s.type === 'frame'
      ? ' stroke="#d3d1c9" stroke-width="1"'
      : ''
  if (s.type === 'ellipse') {
    return `<ellipse cx="${s.x + s.w / 2}" cy="${s.y + s.h / 2}" rx="${s.w / 2}" ry="${s.h / 2}" fill="${esc(s.fill)}"${stroke}${opacity}/>`
  }
  if (s.type === 'text') {
    const size = s.fontSize ?? 20
    return `<text x="${s.x}" y="${s.y + size}" font-size="${size}" font-family="sans-serif" fill="${esc(s.fill)}"${opacity}>${esc(s.text ?? '')}</text>`
  }
  const label =
    s.type === 'frame'
      ? `<text x="${s.x}" y="${s.y - 8}" font-size="12" font-family="monospace" fill="#75726b">${esc(s.text ?? 'Frame')}</text>`
      : ''
  return `${label}<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.radius ?? 0}" fill="${esc(s.fill)}"${stroke}${opacity}/>`
}

// Rasterize shapes to a PNG data URL (agent snapshots and file export).
export async function snapshotCanvas(
  shapes: Shape[],
  { pixelRatio = 1 }: { pixelRatio?: number } = {},
): Promise<string | null> {
  if (shapes.length === 0) return null

  const pad = 40
  const minX = Math.min(...shapes.map((s) => s.x)) - pad
  const minY = Math.min(...shapes.map((s) => s.y)) - pad
  const maxX = Math.max(...shapes.map((s) => s.x + s.w)) + pad
  const maxY = Math.max(...shapes.map((s) => s.y + s.h)) + pad
  const w = maxX - minX
  const h = maxY - minY
  const scale = Math.min(1, 1600 / Math.max(w, h)) * pixelRatio

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${w} ${h}" width="${Math.round(w * scale)}" height="${Math.round(h * scale)}"><rect x="${minX}" y="${minY}" width="${w}" height="${h}" fill="#f1f0ec"/>${renderOrder(
    shapes,
  )
    .map(shapeSvg)
    .join('')}</svg>`

  try {
    const img = new Image()
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = url
    })
    URL.revokeObjectURL(url)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    canvas.getContext('2d')!.drawImage(img, 0, 0)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}
