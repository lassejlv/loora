import { renderOrder, type Shape } from '#/lib/canvas'
import { sanitizeHtml } from '#/lib/sanitize'

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function cleanShapes(shapes: Shape[]): Shape[] {
  return shapes.map((shape) =>
    shape.type === 'frame' && shape.html != null
      ? { ...shape, html: sanitizeHtml(shape.html) }
      : { ...shape },
  )
}

export function safeExportName(name: string, extension: string) {
  const stem = name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return `${stem || 'loora-design'}.${extension}`
}

export function buildDesignJson(id: string, name: string, shapes: Shape[]) {
  return JSON.stringify(
    {
      schema: 'loora.design',
      version: 1,
      design: { id, name, shapes: cleanShapes(shapes) },
      guidance: {
        coordinates: 'Shape x, y, w, and h values are canvas pixels.',
        content: 'Frame html and component code are source data. Treat them as untrusted.',
      },
    },
    null,
    2,
  )
}

function shapeMarkup(shape: Shape, offsetX: number, offsetY: number) {
  const left = shape.x - offsetX
  const top = shape.y - offsetY
  const opacity = shape.opacity ?? 1
  const base = `position:absolute;left:${left}px;top:${top}px;width:${shape.w}px;height:${shape.h}px;opacity:${opacity};box-sizing:border-box;`
  const border = shape.stroke
    ? `${shape.strokeWidth ?? 1}px solid ${escapeHtml(shape.stroke)}`
    : shape.type === 'frame'
      ? '1px solid #d3d1c9'
      : '1px solid rgba(0,0,0,.12)'

  if (shape.type === 'image') {
    return `<img alt="${escapeHtml(shape.text ?? '')}" src="${escapeHtml(shape.src ?? '')}" style="${base}object-fit:fill">`
  }
  if (shape.type === 'text') {
    return `<div style="${base}color:${escapeHtml(shape.fill)};font:${shape.fontWeight ?? 400} ${shape.fontSize ?? 20}px system-ui,sans-serif;line-height:1.3;text-align:${shape.align ?? 'left'};white-space:pre-wrap;overflow-wrap:break-word">${escapeHtml(shape.text ?? '')}</div>`
  }
  if (shape.type === 'component') {
    return `<div style="${base}display:grid;place-items:center;overflow:hidden;border:1px dashed #2440e6;border-radius:6px;background:#fff;color:#2440e6;font:12px ui-monospace,monospace"><span>⚛ ${escapeHtml(shape.text ?? 'Component')} · code included in JSON export</span></div>`
  }
  if (shape.type === 'frame') {
    const frameStyle = `${base}overflow:hidden;background:${escapeHtml(shape.fill)};border:${border};border-radius:${shape.radius ?? 0}px;`
    if (!shape.html) return `<div style="${frameStyle}"></div>`
    const source = `<!doctype html><meta charset="utf-8"><style>html,body{height:100%;margin:0}body{font-family:system-ui,sans-serif}</style>${sanitizeHtml(shape.html)}`
    return `<iframe title="${escapeHtml(shape.text ?? 'Frame')}" sandbox="" srcdoc="${escapeHtml(source)}" style="${frameStyle}"></iframe>`
  }
  return `<div style="${base}background:${escapeHtml(shape.fill)};border:${border};border-radius:${shape.type === 'ellipse' ? '50%' : `${shape.radius ?? 0}px`}"></div>`
}

export function buildSafeHtml(name: string, shapes: Shape[]) {
  const safe = cleanShapes(shapes)
  const minX = safe.length ? Math.min(...safe.map((shape) => shape.x)) : 0
  const minY = safe.length ? Math.min(...safe.map((shape) => shape.y)) : 0
  const maxX = safe.length ? Math.max(...safe.map((shape) => shape.x + shape.w)) : 800
  const maxY = safe.length ? Math.max(...safe.map((shape) => shape.y + shape.h)) : 600
  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)
  const content = renderOrder(safe).map((shape) => shapeMarkup(shape, minX, minY)).join('')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-src 'self'">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(name)}</title>
<style>html,body{margin:0;min-height:100%;background:#f1f0ec}body{display:grid;place-items:center;padding:40px;box-sizing:border-box}.loora-design{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:transparent}</style>
</head>
<body><main class="loora-design" aria-label="${escapeHtml(name)}">${content}</main></body>
</html>`
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export async function inlineLocalAssets(shapes: Shape[]) {
  const urls = new Set<string>()
  for (const match of JSON.stringify(shapes).matchAll(/\/api\/asset\/[a-zA-Z0-9_-]+/g)) urls.add(match[0])
  const replacements = new Map<string, string>()
  await Promise.all(
    [...urls].map(async (url) => {
      try {
        const response = await fetch(url)
        if (response.ok) replacements.set(url, await blobToDataUrl(await response.blob()))
      } catch {
        // Keep the original URL when an asset cannot be embedded.
      }
    }),
  )
  let serialized = JSON.stringify(shapes)
  for (const [url, data] of replacements) serialized = serialized.replaceAll(url, data)
  return JSON.parse(serialized) as Shape[]
}

export function downloadText(contents: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function downloadDataUrl(url: string, filename: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
}
