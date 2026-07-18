import { useEffect, useRef } from 'react'
import { sanitizeHtml } from '#/lib/sanitize'
import { mountFrameTailwind } from '#/lib/frame-tailwind'

// Renders a frame's HTML body inside a shadow root so its <style> rules stay
// scoped to the frame and app styles don't leak in. Tailwind classes work via
// the embedded twind engine watching the shadow root.
export function FrameBody({ html }: { html: string }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>:host{display:block;height:100%;overflow:hidden}</style>${sanitizeHtml(html)}`
    // Constructable stylesheets are missing in test DOMs; render unstyled there.
    if (typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in root)) return
    return mountFrameTailwind(root)
  }, [html])

  // pointer-events none: the frame stays one draggable object on the canvas.
  return <div ref={hostRef} className="pointer-events-none h-full w-full" />
}
