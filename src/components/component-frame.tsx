import { useEffect, useRef } from 'react'

// Claude Design–faithful sandboxed renderer for component shapes.
// Agent JSX defining App runs in an iframe with React 18.3.1 UMD,
// Babel Standalone 7.29.0, and the Tailwind Play CDN.
// Imports/exports are stripped so normal React idioms still work.
//
// The iframe document is static: it boots once, then receives code over
// postMessage and re-compiles/re-mounts in place. Updating a component
// therefore never reloads the iframe or re-fetches the CDN scripts.

const REACT_VERSION = '18.3.1'
const BABEL_VERSION = '7.29.0'
const REACT_UMD = `https://unpkg.com/react@${REACT_VERSION}/umd/react.development.js`
const REACT_DOM_UMD = `https://unpkg.com/react-dom@${REACT_VERSION}/umd/react-dom.development.js`
const BABEL_UMD = `https://unpkg.com/@babel/standalone@${BABEL_VERSION}/babel.min.js`
const HTML_TO_IMAGE_UMD = 'https://unpkg.com/html-to-image@1.11.13/dist/html-to-image.js'

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

export function buildComponentDoc(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<script src="https://cdn.tailwindcss.com"><\/script>
<script src="${REACT_UMD}"><\/script>
<script src="${REACT_DOM_UMD}"><\/script>
<script src="${BABEL_UMD}"><\/script>
<script src="${HTML_TO_IMAGE_UMD}"><\/script>
<style>html,body,#root{height:100%;margin:0}body{font-family:Archivo,system-ui,sans-serif}</style>
</head>
<body>
<div id="root"></div>
<script>
${REACT_GLOBALS_PRELUDE}

var __root = document.getElementById('root')
var __currentRoot = null
// Track roots the agent code creates itself so the previous render can be
// unmounted before the next code payload runs.
var __createRoot = ReactDOM.createRoot.bind(ReactDOM)
ReactDOM.createRoot = function (el, opts) {
  __currentRoot = __createRoot(el, opts)
  return __currentRoot
}
function __showError(message) {
  var pre = document.createElement('pre')
  pre.style.cssText = 'color:#b91c1c;font-size:11px;padding:10px;white-space:pre-wrap;margin:0'
  pre.textContent = message
  __root.replaceChildren(pre)
}
window.addEventListener('error', function (e) {
  if (__root.childNodes.length) return
  __showError(String(e.message || e.error || 'Component crashed'))
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
  try {
    if (__currentRoot) { __currentRoot.unmount(); __currentRoot = null }
    __root.replaceChildren()
    var compiled = Babel.transform(msg.code, { presets: ['react'] }).code
    // Function scope: top-level const/let in the agent code would clash with
    // earlier payloads if evaluated in the global lexical environment.
    var App = new Function(compiled + '\\n;return typeof App !== "undefined" ? App : null')()
    if (msg.needsEntry) {
      var Root = App || function () {
        return React.createElement('pre', { style: { padding: 10, fontSize: 11 } }, 'Code must define function App()')
      }
      ReactDOM.createRoot(__root).render(React.createElement(Root))
    }
  } catch (err) {
    __showError(String((err && err.message) || err))
  }
})
parent.postMessage({ type: 'loora:component-ready' }, '*')
<\/script>
</body>
</html>`
}

const COMPONENT_DOC = buildComponentDoc()

export function ComponentFrame({
  shapeId,
  code,
  interactive,
}: {
  shapeId: string
  code: string
  interactive: boolean
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const readyRef = useRef(false)
  const codeRef = useRef(code)
  codeRef.current = code

  const send = (source: string) => {
    const win = iframeRef.current?.contentWindow
    if (!win || !readyRef.current) return
    const stripped = stripModuleSyntax(source)
    // sandbox="allow-scripts" gives the iframe an opaque origin: '*' required.
    win.postMessage({ type: 'loora:code', code: stripped, needsEntry: !hasEntryCall(stripped) }, '*')
  }

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return
      if ((e.data as { type?: string } | null)?.type !== 'loora:component-ready') return
      readyRef.current = true
      send(codeRef.current)
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
      title="Component"
      sandbox="allow-scripts"
      srcDoc={COMPONENT_DOC}
      data-component-frame={shapeId}
      className="h-full w-full border-0 bg-white"
      style={{ pointerEvents: interactive ? 'auto' : 'none' }}
    />
  )
}

// Ask a mounted component iframe for a PNG of itself. Resolves null when the
// frame is missing, still booting, or slow to respond.
export function captureComponent(shapeId: string, timeoutMs = 1500): Promise<string | null> {
  const iframe = document.querySelector<HTMLIFrameElement>(
    `iframe[data-component-frame="${CSS.escape(shapeId)}"]`,
  )
  if (!iframe?.contentWindow) return Promise.resolve(null)
  const token = `${shapeId}:${Date.now().toString(36)}:${Math.floor(Math.random() * 1e6)}`
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
