import type { Shape } from './canvas'
import { LINE_HEIGHT, renderOrder } from './canvas'
import { sanitizeHtml, toXhtml } from './sanitize'
import { frameCss } from './frame-tailwind'
import { captureComponent } from '#/components/component-frame'

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Image shapes reference same-origin URLs; SVG rasterization loads the markup
// in an isolated document, so hrefs must be inlined as data URLs first.
const imageDataCache = new Map<string, string | null>()

async function toDataUrl(src: string): Promise<string | null> {
  const cached = imageDataCache.get(src)
  if (cached !== undefined) return cached
  try {
    const blob = await (await fetch(src)).blob()
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
    imageDataCache.set(src, url)
    return url
  } catch {
    imageDataCache.set(src, null)
    return null
  }
}

function shapeSvg(
  s: Shape,
  imageData?: Map<string, string | null>,
  componentShots?: Map<string, string | null>,
): string {
  const opacity = s.opacity != null ? ` opacity="${s.opacity}"` : ''
  if (s.type === 'image') {
    const href = s.src ? imageData?.get(s.src) : null
    if (!href) {
      return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="#e5e3dc"${opacity}/>`
    }
    return `<image x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" preserveAspectRatio="none" href="${esc(href)}"${opacity}/>`
  }
  if (s.type === 'component') {
    const shot = componentShots?.get(s.id)
    if (shot) {
      return `<image x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" preserveAspectRatio="none" href="${esc(shot)}"${opacity}/>`
    }
    // Frame not mounted or capture failed: labeled placeholder.
    return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="6" fill="#ffffff" stroke="#2440e6" stroke-dasharray="6 4"${opacity}/><text x="${s.x + 10}" y="${s.y + 22}" font-size="13" font-family="monospace" fill="#2440e6">⚛ ${esc(s.text ?? 'Component')} (not rendered)</text>`
  }
  const stroke = s.stroke
    ? ` stroke="${esc(s.stroke)}" stroke-width="${s.strokeWidth ?? 1}"`
    : s.type === 'frame'
      ? ' stroke="#d3d1c9" stroke-width="1"'
      : ''
  if (s.type === 'ellipse') {
    return `<ellipse cx="${s.x + s.w / 2}" cy="${s.y + s.h / 2}" rx="${s.w / 2}" ry="${s.h / 2}" fill="${esc(s.fill)}"${stroke}${opacity}/>`
  }
  if (s.type === 'text') {
    // Match the live DOM renderer: a wrapping div, not manual tspans.
    const style = `font:${s.fontWeight ?? 400} ${s.fontSize ?? 20}px sans-serif;line-height:${LINE_HEIGHT};color:${s.fill};text-align:${s.align ?? 'left'};white-space:pre-wrap;overflow-wrap:break-word;width:${s.w}px;height:${s.h}px`
    return `<foreignObject x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" style="overflow:visible"${opacity}><div xmlns="http://www.w3.org/1999/xhtml" style="${esc(style)}">${esc(s.text ?? '')}</div></foreignObject>`
  }
  if (s.type === 'frame') {
    const label = `<text x="${s.x}" y="${s.y - 8}" font-size="12" font-family="monospace" fill="#75726b">${esc(s.text ?? 'Frame')}</text>`
    const box = `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.radius ?? 0}" fill="${esc(s.fill)}"${stroke}${opacity}/>`
    if (!s.html) return `${label}${box}`
    const safe = sanitizeHtml(s.html)
    const body = toXhtml(safe)
    // XML-escape only & and < : full esc() would mangle quotes in CSS strings.
    const tailwind = `<style>${frameCss(safe).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</style>`
    return `${label}${box}<foreignObject x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}"${opacity}><div xmlns="http://www.w3.org/1999/xhtml" style="width:${s.w}px;height:${s.h}px;overflow:hidden;font-family:sans-serif">${tailwind}${body}</div></foreignObject>`
  }
  return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.radius ?? 0}" fill="${esc(s.fill)}"${stroke}${opacity}/>`
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

  const srcs = [...new Set(shapes.filter((s) => s.type === 'image' && s.src).map((s) => s.src!))]
  const imageData = new Map(
    await Promise.all(srcs.map(async (src) => [src, await toDataUrl(src)] as const)),
  )

  // Live component iframes capture themselves and hand back PNGs.
  const componentIds = shapes.filter((s) => s.type === 'component').map((s) => s.id)
  const componentShots = new Map(
    await Promise.all(
      componentIds.map(async (id) => [id, await captureComponent(id)] as const),
    ),
  )

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${w} ${h}" width="${Math.round(w * scale)}" height="${Math.round(h * scale)}"><rect x="${minX}" y="${minY}" width="${w}" height="${h}" fill="#f1f0ec"/>${renderOrder(
    shapes,
  )
    .map((s) => shapeSvg(s, imageData, componentShots))
    .join('')}</svg>`

  try {
    const img = new Image()
    // data: URL, not blob: — Chrome taints the canvas when a blob-loaded SVG
    // contains <foreignObject>, which breaks toDataURL.
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    canvas.getContext('2d')!.drawImage(img, 0, 0)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}
