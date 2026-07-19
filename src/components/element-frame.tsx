import { useEffect, useRef } from 'react'

// Sandboxed renderer for canvas elements. Every element is code — plain
// HTML/CSS/JS or JSX defining App — running in an iframe with React 18,
// Babel Standalone, and Tailwind (all vendored, same-origin).
//
// The iframe document is static: it boots once, then receives code over
// postMessage and re-renders in place. Updating an element never reloads
// the iframe or re-fetches the runtime scripts.
//
// Rendering is last-good: a payload that fails to compile leaves the
// previous render untouched, so streaming partial code is safe — the parent
// pushes every chunk and the latest compilable one wins.

const VENDOR_SCRIPTS = [
  '/vendor/tailwind.js',
  '/vendor/react.js',
  '/vendor/react-dom.js',
  '/vendor/babel.js',
  '/vendor/html-to-image.js',
] as const

/**
 * Strip ES module import/export so Babel's classic preset can run.
 * Agents reflexively write `import { useState } from 'react'` and
 * `export default function App()` — those are SyntaxErrors without this.
 */
export function stripModuleSyntax(source: string): string {
  let out = source
  out = out.replace(/^[\t ]*import\b[\s\S]*?from\s*['"][^'"]+['"]\s*;?[\t ]*\r?\n?/gm, '')
  out = out.replace(/^[\t ]*import\s*['"][^'"]+['"]\s*;?[\t ]*\r?\n?/gm, '')
  out = out.replace(/^([\t ]*)export\s+default\s+(function|class)\s+/gm, '$1$2 ')
  out = out.replace(/^([\t ]*)export\s+default\s+/gm, '$1')
  out = out.replace(
    /^([\t ]*)export\s+(const|let|var|function|class|async\s+function)\s+/gm,
    '$1$2 ',
  )
  out = out.replace(/^[\t ]*export\s*\{[\s\S]*?\}\s*;?[\t ]*\r?\n?/gm, '')
  return out
}

/**
 * Assign hooks onto globalThis (not lexical const) so bare `useState(...)`
 * works after import stripping, and agent-side `const { useState } = React`
 * does not collide with a prelude binding.
 */
export const REACT_GLOBALS_PRELUDE = [
  'Object.assign(globalThis, {',
  '  useState: React.useState, useEffect: React.useEffect, useRef: React.useRef,',
  '  useMemo: React.useMemo, useCallback: React.useCallback,',
  '  useContext: React.useContext, useReducer: React.useReducer,',
  '  useLayoutEffect: React.useLayoutEffect,',
  '  useImperativeHandle: React.useImperativeHandle,',
  '  useTransition: React.useTransition, useDeferredValue: React.useDeferredValue,',
  '  useId: React.useId,',
  '  Fragment: React.Fragment, createContext: React.createContext,',
  '  forwardRef: React.forwardRef, memo: React.memo, lazy: React.lazy,',
  '  Suspense: React.Suspense, StrictMode: React.StrictMode,',
  '});',
].join('\n')

// Allows one level of nested parens so createRoot(document.getElementById('root')) matches.
const HAS_ENTRY_RE = /ReactDOM\.createRoot\s*\((?:[^()]|\([^()]*\))*\)\s*\.render/

export function hasEntryCall(source: string): boolean {
  return HAS_ENTRY_RE.test(source) || /ReactDOM\.render\s*\(/.test(source)
}

export type CodeMode = 'jsx-app' | 'jsx-snippet' | 'html'

/**
 * Decide how a code payload renders. `App` definitions compile as React;
 * markup with JSX-only syntax (className, component tags, expression
 * attributes) compiles as a JSX fragment; everything else that reads as
 * markup mounts as plain HTML with live inline scripts. Misclassified
 * snippets fall back to the HTML path inside the iframe when Babel rejects
 * them, so the heuristic only has to be right most of the time.
 */
export function classifyCode(source: string): CodeMode {
  const stripped = stripModuleSyntax(source)
  if (/\b(function|const|let|var|class)\s+App\b/.test(stripped)) return 'jsx-app'
  const trimmed = stripped.trim()
  if (!trimmed.startsWith('<')) return 'jsx-snippet'
  if (/^<!doctype/i.test(trimmed)) return 'html'
  if (/className=|<\/?[A-Z]|=\{/.test(trimmed)) return 'jsx-snippet'
  return 'html'
}

export function buildElementDoc(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
${VENDOR_SCRIPTS.map((src) => `<script src="${src}"><\/script>`).join('\n')}
<style>html,body{margin:0;height:100%;background:transparent}#root{height:100%}body{font-family:Archivo,system-ui,sans-serif}</style>
</head>
<body>
<div id="root"></div>
<script>
${REACT_GLOBALS_PRELUDE}

var __root = document.getElementById('root')
var __currentRoot = null
var __seq = 0
// Track roots the agent code creates itself so the previous render can be
// unmounted before the next code payload runs.
var __createRoot = ReactDOM.createRoot.bind(ReactDOM)
ReactDOM.createRoot = function (el, opts) {
  __currentRoot = __createRoot(el, opts)
  return __currentRoot
}
function __teardown() {
  if (__currentRoot) {
    try { __currentRoot.unmount() } catch (e) {}
    __currentRoot = null
  }
  __root.replaceChildren()
}
function __mountHtml(code) {
  __teardown()
  __root.innerHTML = code
  // innerHTML never executes scripts; recreate each node so inline JS runs.
  var scripts = __root.querySelectorAll('script')
  for (var i = 0; i < scripts.length; i++) {
    var old = scripts[i]
    var fresh = document.createElement('script')
    for (var j = 0; j < old.attributes.length; j++) {
      fresh.setAttribute(old.attributes[j].name, old.attributes[j].value)
    }
    fresh.textContent = old.textContent
    old.parentNode.replaceChild(fresh, old)
  }
}
// Runtime errors (React render, event handlers, element scripts) surface as
// a badge in the parent; the DOM is left as-is.
window.addEventListener('error', function (e) {
  parent.postMessage(
    { type: 'loora:error', seq: __seq, message: String(e.message || e.error || 'Element crashed') },
    '*',
  )
})
window.addEventListener('message', function (e) {
  var msg = e.data
  if (!msg) return
  // Canvas snapshots can't see into the sandboxed iframe, so the frame
  // captures itself on request and posts the PNG back to the parent.
  if (msg.type === 'loora:capture') {
    var reply = function (png) {
      parent.postMessage({ type: 'loora:capture-result', token: msg.token, png: png }, '*')
    }
    if (!window.htmlToImage) return reply(null)
    htmlToImage.toPng(document.body).then(reply, function () { reply(null) })
    return
  }
  if (msg.type !== 'loora:code' || typeof msg.code !== 'string') return
  __seq = msg.seq || 0
  try {
    if (msg.mode === 'html') {
      __mountHtml(msg.code)
    } else {
      var source = msg.mode === 'jsx-snippet'
        ? 'function App() { return <>\\n' + msg.code + '\\n</> }'
        : msg.code
      var compiled
      try {
        // Compile before touching the DOM: a broken payload (streaming chunk,
        // bad final code) keeps the previous render on screen.
        compiled = Babel.transform(source, { presets: ['react'] }).code
      } catch (err) {
        // A snippet that looked like JSX may be plain HTML after all.
        if (msg.mode === 'jsx-snippet' && /^</.test(msg.code.trim())) {
          __mountHtml(msg.code)
          parent.postMessage({ type: 'loora:ok', seq: __seq }, '*')
          return
        }
        throw err
      }
      __teardown()
      // Function scope: top-level const/let in the agent code would clash with
      // earlier payloads if evaluated in the global lexical environment.
      var App = new Function(compiled + '\\n;return typeof App !== "undefined" ? App : null')()
      if (msg.needsEntry) {
        var Root = App || function () {
          return React.createElement('pre', { style: { padding: 10, fontSize: 11 } }, 'Code must define function App()')
        }
        ReactDOM.createRoot(__root).render(React.createElement(Root))
      }
    }
    parent.postMessage({ type: 'loora:ok', seq: __seq }, '*')
  } catch (err) {
    parent.postMessage(
      { type: 'loora:error', seq: __seq, message: String((err && err.message) || err) },
      '*',
    )
  }
})
parent.postMessage({ type: 'loora:element-ready' }, '*')
<\/script>
</body>
</html>`
}

const ELEMENT_DOC = buildElementDoc()

export function ElementFrame({
  elementId,
  code,
  interactive,
  onError,
}: {
  elementId: string
  code: string
  interactive: boolean
  // Called with a message when the latest payload failed, null when it rendered.
  onError?: (message: string | null) => void
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const readyRef = useRef(false)
  const codeRef = useRef(code)
  codeRef.current = code
  const seqRef = useRef(0)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const send = (source: string) => {
    const win = iframeRef.current?.contentWindow
    if (!win || !readyRef.current) return
    const stripped = stripModuleSyntax(source)
    const mode = classifyCode(source)
    seqRef.current += 1
    // sandbox="allow-scripts" gives the iframe an opaque origin: '*' required.
    win.postMessage(
      {
        type: 'loora:code',
        code: stripped,
        mode,
        seq: seqRef.current,
        needsEntry: mode !== 'jsx-app' || !hasEntryCall(stripped),
      },
      '*',
    )
  }

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return
      const msg = e.data as { type?: string; seq?: number; message?: string } | null
      if (msg?.type === 'loora:element-ready') {
        readyRef.current = true
        send(codeRef.current)
        return
      }
      // Stale replies (an old payload settling after a newer send) are ignored.
      if (msg?.type === 'loora:ok' && msg.seq === seqRef.current) {
        onErrorRef.current?.(null)
      }
      if (msg?.type === 'loora:error' && msg.seq === seqRef.current) {
        onErrorRef.current?.(msg.message ?? 'Element failed to render')
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    send(code)
  }, [code])

  return (
    <iframe
      ref={iframeRef}
      title="Element"
      sandbox="allow-scripts"
      srcDoc={ELEMENT_DOC}
      data-element-frame={elementId}
      className="h-full w-full border-0"
      style={{ pointerEvents: interactive ? 'auto' : 'none' }}
    />
  )
}

// Ask a mounted element iframe for a PNG of itself. Resolves null when the
// frame is missing, still booting, or slow to respond.
export function captureElement(elementId: string, timeoutMs = 1500): Promise<string | null> {
  const iframe = document.querySelector<HTMLIFrameElement>(
    `iframe[data-element-frame="${CSS.escape(elementId)}"]`,
  )
  if (!iframe?.contentWindow) return Promise.resolve(null)
  const token = `${elementId}:${Date.now().toString(36)}:${Math.floor(Math.random() * 1e6)}`
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage)
      resolve(null)
    }, timeoutMs)
    const onMessage = (e: MessageEvent) => {
      const msg = e.data as { type?: string; token?: string; png?: string | null }
      if (msg?.type !== 'loora:capture-result' || msg.token !== token) return
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      resolve(typeof msg.png === 'string' ? msg.png : null)
    }
    window.addEventListener('message', onMessage)
    iframe.contentWindow!.postMessage({ type: 'loora:capture', token }, '*')
  })
}
