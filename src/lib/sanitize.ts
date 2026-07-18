// Sanitize agent-generated frame HTML before it touches the DOM.
// Allows plain HTML, inline styles, and <style> blocks; strips anything
// that can execute script or reach outside the frame's shadow root.

const BLOCKED_TAGS = new Set([
  'script',
  'iframe',
  'frame',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'form',
])

const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction'])

// Allowlist, not blocklist: relative URLs, fragments, http(s), mailto, and
// data:image/* only. Everything else (javascript:, vbscript:, data:text/…,
// blob:, …) is stripped.
function isSafeUrl(raw: string): boolean {
  const value = raw.trim().toLowerCase().replace(/[\s\u0000-\u001f]/gu, "")
  if (!/^[a-z][a-z0-9+.-]*:/.test(value)) return true // relative / fragment / path
  return (
    value.startsWith('http:') ||
    value.startsWith('https:') ||
    value.startsWith('mailto:') ||
    value.startsWith('data:image/')
  )
}

function scrubElement(el: Element) {
  for (const attr of [...el.attributes]) {
    const name = attr.name.toLowerCase()
    if (name.startsWith('on') || name === 'srcdoc') {
      el.removeAttribute(attr.name)
      continue
    }
    if (URL_ATTRS.has(name) && !isSafeUrl(attr.value)) {
      el.removeAttribute(attr.name)
    }
  }
}

export function sanitizeHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return html // node test env: stored raw, sanitized on render
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  for (const el of [...doc.body.querySelectorAll('*')]) {
    if (BLOCKED_TAGS.has(el.tagName.toLowerCase())) {
      el.remove()
      continue
    }
    scrubElement(el)
  }
  return doc.body.innerHTML
}

// Snapshot rasterizes HTML inside SVG <foreignObject>, which needs well-formed
// XML. Round-trip through the HTML parser and serialize as XHTML.
export function toXhtml(html: string): string {
  if (typeof DOMParser === 'undefined') return html
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const container = doc.createElement('div')
  // Full-height so percentage heights (e.g. Tailwind h-full) resolve against
  // the fixed-size foreignObject wrapper instead of collapsing to auto.
  container.setAttribute('style', 'height:100%')
  container.append(...doc.body.childNodes)
  return new XMLSerializer().serializeToString(container)
}
