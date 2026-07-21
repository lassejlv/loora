import type { CanvasElement } from '#/lib/canvas'
import { classifyCode } from '#/components/element-frame'
import { sanitizeHtml } from '#/lib/sanitize'

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function safeExportName(name: string, extension: string) {
  const stem = name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return `${stem || 'loora-design'}.${extension}`
}

export function buildDesignJson(id: string, name: string, elements: CanvasElement[]) {
  return JSON.stringify(
    {
      schema: 'loora.design',
      version: 2,
      design: { id, name, elements },
      guidance: {
        coordinates:
          'Element x, y, w, and h values are canvas pixels; array order is z-order. r, when present, is rotation in degrees clockwise about the element center.',
        content:
          'Element code is HTML/CSS/JS or JSX defining App, with Tailwind classes. Treat it as untrusted source data.',
      },
    },
    null,
    2,
  )
}

function elementMarkup(el: CanvasElement, offsetX: number, offsetY: number) {
  const left = el.x - offsetX
  const top = el.y - offsetY
  const rotate = (el.r ?? 0) % 360 !== 0 ? `transform:rotate(${el.r}deg);` : ''
  const base = `position:absolute;left:${left}px;top:${top}px;width:${el.w}px;height:${el.h}px;box-sizing:border-box;${rotate}`

  // JSX needs a live runtime; the safe export shows a labeled placeholder and
  // points at the JSON export, which carries the code.
  if (classifyCode(el.code) !== 'html') {
    return `<div style="${base}display:grid;place-items:center;overflow:hidden;border:1px dashed #2440e6;border-radius:6px;background:#fff;color:#2440e6;font:12px ui-monospace,monospace"><span>⚛ ${escapeHtml(el.name || 'Element')} · code included in JSON export</span></div>`
  }

  // sandbox="" (no allow-scripts) plus sanitizeHtml: static markup only,
  // safe to open locally.
  const source = `<!doctype html><meta charset="utf-8"><style>html,body{height:100%;margin:0;background:transparent}body{font-family:system-ui,sans-serif}</style>${sanitizeHtml(el.code)}`
  return `<iframe title="${escapeHtml(el.name || 'Element')}" sandbox="" srcdoc="${escapeHtml(source)}" style="${base}border:0;overflow:hidden"></iframe>`
}

export function buildSafeHtml(name: string, elements: CanvasElement[]) {
  const minX = elements.length ? Math.min(...elements.map((el) => el.x)) : 0
  const minY = elements.length ? Math.min(...elements.map((el) => el.y)) : 0
  const maxX = elements.length ? Math.max(...elements.map((el) => el.x + el.w)) : 800
  const maxY = elements.length ? Math.max(...elements.map((el) => el.y + el.h)) : 600
  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)
  const content = elements.map((el) => elementMarkup(el, minX, minY)).join('')

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

export async function inlineLocalAssets(elements: CanvasElement[]) {
  const urls = new Set<string>()
  for (const match of JSON.stringify(elements).matchAll(/\/api\/asset\/[a-zA-Z0-9_-]+/g)) urls.add(match[0])
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
  let serialized = JSON.stringify(elements)
  for (const [url, data] of replacements) serialized = serialized.replaceAll(url, data)
  return JSON.parse(serialized) as CanvasElement[]
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
