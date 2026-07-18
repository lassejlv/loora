import { useMemo } from 'react'

// Claude Design–faithful sandboxed renderer for component shapes.
// Agent JSX defining App runs in an iframe with React 18.3.1 UMD,
// Babel Standalone 7.29.0, and the Tailwind Play CDN.
// Imports/exports are stripped so normal React idioms still work.

const REACT_VERSION = '18.3.1'
const BABEL_VERSION = '7.29.0'
const REACT_UMD = `https://unpkg.com/react@${REACT_VERSION}/umd/react.development.js`
const REACT_DOM_UMD = `https://unpkg.com/react-dom@${REACT_VERSION}/umd/react-dom.development.js`
const BABEL_UMD = `https://unpkg.com/@babel/standalone@${BABEL_VERSION}/babel.min.js`
const HTML_TO_IMAGE_UMD = 'https://unpkg.com/html-to-image@1.11.13/dist/html-to-image.js'

/**
 * Strip ES module import/export so Babel's classic text/babel preset can run.
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

/** Escape `</script>` so agent source cannot close the outer Babel script tag. */
export function escapeForScript(source: string): string {
  return source.replace(/<\/script>/gi, '<\\/script>')
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

export function buildComponentDoc(code: string): string {
  const stripped = stripModuleSyntax(code)
  const safe = escapeForScript(stripped)
  const needsEntry = !hasEntryCall(stripped)

  const mountBlock = needsEntry
    ? `
const Root = typeof App !== 'undefined'
  ? App
  : () => React.createElement('pre', { style: { padding: 10, fontSize: 11 } }, 'Code must define function App()')
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Root))
`
    : ''

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
window.addEventListener('error', function (e) {
  var root = document.getElementById('root')
  if (!root || root.childNodes.length) return
  var pre = document.createElement('pre')
  pre.style.cssText = 'color:#b91c1c;font-size:11px;padding:10px;white-space:pre-wrap;margin:0'
  pre.textContent = String(e.message || e.error || 'Component crashed')
  root.replaceChildren(pre)
})
// Canvas snapshots can't see into the sandboxed iframe, so the frame
// captures itself on request and posts the PNG back to the parent.
window.addEventListener('message', function (e) {
  var msg = e.data
  if (!msg || msg.type !== 'loora:capture') return
  var reply = function (png) {
    parent.postMessage({ type: 'loora:capture-result', token: msg.token, png: png }, '*')
  }
  if (!window.htmlToImage) return reply(null)
  htmlToImage.toPng(document.body).then(reply, function () { reply(null) })
})
<\/script>
<script type="text/babel" data-presets="react">
${REACT_GLOBALS_PRELUDE}

${safe}
${mountBlock}
<\/script>
</body>
</html>`
}

export function ComponentFrame({
  shapeId,
  code,
  interactive,
}: {
  shapeId: string
  code: string
  interactive: boolean
}) {
  const doc = useMemo(() => buildComponentDoc(code), [code])
  return (
    <iframe
      title="Component"
      sandbox="allow-scripts"
      srcDoc={doc}
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
