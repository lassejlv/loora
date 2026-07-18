import { useMemo } from 'react'

// Sandboxed live renderer for component shapes. The shape's `code` is JSX that
// must define `function App()`; it runs in an iframe with React 19 (esm.sh),
// Babel standalone for JSX, and the Tailwind CDN for styling.
export function buildComponentDoc(code: string): string {
  // </script> inside the source would terminate the babel script block early.
  const safe = code.replace(/<\/script/gi, '<\\/script')
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<script src="https://cdn.tailwindcss.com"><\/script>
<script src="https://unpkg.com/@babel/standalone@7/babel.min.js"><\/script>
<script type="importmap">
{"imports":{"react":"https://esm.sh/react@19.1.0","react-dom/client":"https://esm.sh/react-dom@19.1.0/client","react/jsx-runtime":"https://esm.sh/react@19.1.0/jsx-runtime"}}
<\/script>
<style>html,body,#root{height:100%}body{margin:0;font-family:Archivo,system-ui,sans-serif}</style>
</head>
<body>
<div id="root"></div>
<script>
window.addEventListener('error', function (e) {
  var root = document.getElementById('root')
  var pre = document.createElement('pre')
  pre.style.cssText = 'color:#b91c1c;font-size:11px;padding:10px;white-space:pre-wrap;margin:0'
  pre.textContent = String(e.message || e.error || 'Component crashed')
  root.replaceChildren(pre)
})
<\/script>
<script type="text/babel" data-type="module" data-presets="react">
import React from 'react'
import { createRoot } from 'react-dom/client'
const { useState, useEffect, useRef, useMemo, useCallback, useReducer } = React

${safe}

const Root = typeof App !== 'undefined'
  ? App
  : () => React.createElement('pre', { style: { padding: 10, fontSize: 11 } }, 'Code must define function App()')
createRoot(document.getElementById('root')).render(React.createElement(Root))
<\/script>
</body>
</html>`
}

export function ComponentFrame({
  code,
  interactive,
}: {
  code: string
  interactive: boolean
}) {
  const doc = useMemo(() => buildComponentDoc(code), [code])
  return (
    <iframe
      title="Component"
      sandbox="allow-scripts"
      srcDoc={doc}
      className="h-full w-full border-0 bg-white"
      style={{ pointerEvents: interactive ? 'auto' : 'none' }}
    />
  )
}
