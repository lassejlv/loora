import { useEffect, useRef } from 'react'

// Sandboxed renderer for canvas elements. Every element is code — plain
// HTML/CSS/JS or JSX/TSX defining App — running in an iframe with React and
// Tailwind (vendored, same-origin).
//
// JSX compiles in the PARENT document with a single shared Babel instance
// (lazy-loaded once), so each iframe only boots React + Tailwind instead of
// re-parsing a 3MB compiler. Compile errors are known before anything is sent
// and are reported both to the UI and to the agent via the render registry.
//
// The iframe document is static: it boots once, then receives compiled code
// over postMessage and re-renders in place. Updating an element never reloads
// the iframe or re-fetches the runtime scripts.
//
// Rendering is last-good: a payload that fails to compile leaves the
// previous render untouched, so streaming partial code is safe — the parent
// pushes every chunk and the latest compilable one wins.

const VENDOR_SCRIPTS = [
  '/vendor/tailwind.js',
  '/vendor/react.js',
  '/vendor/react-dom.js',
  '/vendor/html-to-image.js',
] as const

const FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Spline+Sans+Mono:wght@400;500&display=swap'

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
 * snippets fall back to the HTML path when Babel rejects them, so the
 * heuristic only has to be right most of the time.
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

// ---------------------------------------------------------------------------
// Parent-side compiler

export interface BabelLike {
  transform: (code: string, options: Record<string, unknown>) => { code?: string | null }
}

export interface FramePayload {
  mode: 'js' | 'html'
  code: string
  needsEntry: boolean
}

export type CompileResult = { ok: true; payload: FramePayload } | { ok: false; error: string }

let babelPromise: Promise<BabelLike> | null = null

/** Lazy-load the vendored Babel standalone once, shared by every frame. */
export function ensureBabel(): Promise<BabelLike> {
  const existing = (globalThis as { Babel?: BabelLike }).Babel
  if (existing) return Promise.resolve(existing)
  if (!babelPromise) {
    babelPromise = new Promise<BabelLike>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = '/vendor/babel.js'
      script.onload = () => {
        const babel = (globalThis as { Babel?: BabelLike }).Babel
        if (babel) resolve(babel)
        else reject(new Error('The JSX compiler failed to initialize'))
      }
      script.onerror = () => reject(new Error('The JSX compiler failed to load'))
      document.head.appendChild(script)
    })
    // A failed load may be transient (dev server restart); allow a retry.
    babelPromise.catch(() => {
      babelPromise = null
    })
  }
  return babelPromise
}

function firstErrorLine(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  // Babel prefixes messages with the pseudo-filename and appends a code frame.
  const line = raw.replace(/^unknown: /, '').split('\n')[0]
  return line.length > 400 ? `${line.slice(0, 400)}…` : line
}

/**
 * Babel messages carry a (line:col) into the compiled source; echo that source
 * line so the agent sees the offending code instead of guessing from a bare
 * position — import stripping shifts line numbers relative to what it wrote.
 */
export function describeCompileError(error: unknown, source: string): string {
  const line = firstErrorLine(error)
  const loc = line.match(/\((\d+):\d+\)/)
  if (loc) {
    const text = source.split('\n')[Number(loc[1]) - 1]?.trim()
    if (text) {
      return `${line} — ${text.length > 200 ? `${text.slice(0, 200)}…` : text}`
    }
  }
  return line
}

function transform(babel: BabelLike, source: string, withTypescript: boolean): string {
  const presets: unknown[] = withTypescript
    ? [['react', {}], ['typescript', { isTSX: true, allExtensions: true }]]
    : [['react', {}]]
  const out = babel.transform(source, { presets })
  if (typeof out?.code !== 'string') throw new Error('Compilation produced no output')
  return out.code
}

/**
 * Compile a raw code payload into what the frame runtime executes.
 * Pure so it is unit-testable; `babel` may be null for html-only payloads.
 * TSX is tried first (agents write TypeScript constantly); plain-React is the
 * fallback in case the TypeScript preset chokes on valid JSX.
 */
export function compileForFrame(source: string, babel: BabelLike | null): CompileResult {
  const stripped = stripModuleSyntax(source)
  const mode = classifyCode(source)
  if (mode === 'html') {
    return { ok: true, payload: { mode: 'html', code: stripped, needsEntry: false } }
  }
  if (!babel) return { ok: false, error: 'The JSX compiler is unavailable' }
  const jsxSource =
    mode === 'jsx-snippet' ? `function App() { return <>\n${stripped}\n</> }` : stripped
  try {
    let compiled: string
    try {
      compiled = transform(babel, jsxSource, true)
    } catch (tsError) {
      try {
        compiled = transform(babel, jsxSource, false)
      } catch {
        throw tsError
      }
    }
    return {
      ok: true,
      payload: {
        mode: 'js',
        code: compiled,
        needsEntry: mode !== 'jsx-app' || !hasEntryCall(stripped),
      },
    }
  } catch (error) {
    // A snippet that looked like JSX may be plain HTML after all.
    if (mode === 'jsx-snippet' && stripped.trim().startsWith('<')) {
      return { ok: true, payload: { mode: 'html', code: stripped, needsEntry: false } }
    }
    return { ok: false, error: describeCompileError(error, jsxSource) }
  }
}

// ---------------------------------------------------------------------------
// Render-status registry: the latest compile/runtime outcome per element,
// awaited by the agent tool loop so broken code comes back as feedback
// instead of silently leaving a stale frame on the canvas.

interface RenderRecord {
  error: string | null
  at: number
}

const renderResults = new Map<string, RenderRecord>()
const renderWaiters = new Map<string, (() => void)[]>()
const frameRevisions = new Map<string, number>()

function noteFrameRevision(elementId: string, revision?: number) {
  const current = frameRevisions.get(elementId) ?? 0
  const next = revision === undefined ? current + 1 : Math.max(current, revision)
  frameRevisions.set(elementId, next)
  return next
}

export function getElementCaptureRevision(elementId: string) {
  return frameRevisions.get(elementId) ?? 0
}

function reportRender(elementId: string, error: string | null) {
  renderResults.set(elementId, { error, at: Date.now() })
  const waiters = renderWaiters.get(elementId)
  if (waiters) {
    renderWaiters.delete(elementId)
    for (const waiter of waiters) waiter()
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function frameMounted(elementId: string): boolean {
  if (typeof document === 'undefined') return false
  const selector = `iframe[data-element-frame="${elementId.replace(/"/g, '\\"')}"]`
  return document.querySelector(selector) !== null
}

/**
 * Wait for the outcome of the element's current code: `{ok: true}` when it
 * rendered, `{ok: false, error}` when compile or runtime failed, `null` when
 * no frame is mounted or nothing settled in time. React surfaces render
 * errors asynchronously (a window error event a beat after the ok ack), so a
 * short grace period lets a trailing error override a premature ok.
 */
export async function awaitRenderResult(
  elementId: string,
  timeoutMs = 1500,
): Promise<{ ok: boolean; error?: string } | null> {
  const recent = () => {
    const record = renderResults.get(elementId)
    return record && Date.now() - record.at < 5000 ? record : null
  }
  if (!recent()) {
    // Let the frame mount (element creation commits before iframes exist).
    await sleep(50)
    if (!frameMounted(elementId)) return null
    if (!recent()) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          const list = renderWaiters.get(elementId)
          if (list) {
            renderWaiters.set(
              elementId,
              list.filter((w) => w !== waiter),
            )
          }
          resolve()
        }, timeoutMs)
        const waiter = () => {
          clearTimeout(timer)
          resolve()
        }
        renderWaiters.set(elementId, [...(renderWaiters.get(elementId) ?? []), waiter])
      })
    }
  }
  if (!renderResults.get(elementId)) return null
  await sleep(300)
  const latest = renderResults.get(elementId)
  if (!latest) return null
  return latest.error === null ? { ok: true } : { ok: false, error: latest.error }
}

// ---------------------------------------------------------------------------
// Frame document

export function buildElementDoc(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<link rel="stylesheet" href="${FONTS_URL}" crossorigin="anonymous" />
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
var __revision = 0
var __dirty = false

function __postDirty() {
  parent.postMessage({ type: 'loora:dirty', revision: __revision }, '*')
}
function __markDirty() {
  __revision += 1
  if (__dirty) return
  __dirty = true
  __postDirty()
}

new MutationObserver(__markDirty).observe(__root, {
  subtree: true,
  childList: true,
  attributes: true,
  characterData: true,
})
;['input', 'change', 'pointerdown', 'keydown'].forEach(function (type) {
  document.addEventListener(type, __markDirty, true)
})

// Track roots the agent code creates itself so the previous render can be
// unmounted before the next code payload runs.
var __createRoot = ReactDOM.createRoot.bind(ReactDOM)
ReactDOM.createRoot = function (el, opts) {
  __currentRoot = __createRoot(el, opts)
  return __currentRoot
}

// Payload code must never navigate this document: forms stay put (state-based
// demos keep working via their submit handlers) and links are inert except
// same-document hash jumps.
document.addEventListener('submit', function (e) { e.preventDefault() })
document.addEventListener('click', function (e) {
  var a = e.target && e.target.closest ? e.target.closest('a[href]') : null
  if (!a) return
  var href = a.getAttribute('href') || ''
  if (href.charAt(0) !== '#') e.preventDefault()
})

// Runtime log buffer: console.error/warn plus uncaught errors, readable by
// the agent via loora:read-logs. Catches what the render handshake misses —
// errors thrown after the ok grace period, from timers, or from user
// interaction with the live element.
var __logs = []
function __pushLog(level, message) {
  __logs.push(level + ': ' + String(message).slice(0, 500))
  if (__logs.length > 50) __logs.shift()
}
;['error', 'warn'].forEach(function (level) {
  var orig = console[level].bind(console)
  console[level] = function () {
    __pushLog(level, Array.prototype.slice.call(arguments).map(function (a) {
      if (typeof a === 'string') return a
      try { return JSON.stringify(a) } catch (e) { return String(a) }
    }).join(' '))
    return orig.apply(null, arguments)
  }
})

// Runtime errors (React render, event handlers, element scripts) surface as
// a badge in the parent; the DOM is left as-is.
window.addEventListener('error', function (e) {
  var message = String(e.message || e.error || 'Element crashed')
  __pushLog('uncaught', message)
  parent.postMessage({ type: 'loora:error', seq: __seq, message: message }, '*')
})
window.addEventListener('unhandledrejection', function (e) {
  var r = e.reason
  var message = String((r && r.message) || r || 'Unhandled promise rejection')
  __pushLog('uncaught', message)
  parent.postMessage({ type: 'loora:error', seq: __seq, message: message }, '*')
})

// Every payload re-executes the element code, so timers, animation frames,
// and window/document listeners it registers are tracked and cleared before
// the next payload runs — a streamed clock must not end up with 40 intervals.
// Installed at the very END of this script: every runtime listener above and
// below stays untracked; only listeners added later (payload code) qualify.
var __timers = []
var __intervals = []
var __rafs = []
var __listeners = []
function __installPayloadTracking() {
  var st = window.setTimeout.bind(window)
  var si = window.setInterval.bind(window)
  var rf = window.requestAnimationFrame.bind(window)
  window.setTimeout = function (fn) {
    var args = Array.prototype.slice.call(arguments, 1)
    var wrapped = typeof fn === 'function' ? function () { __markDirty(); return fn.apply(this, arguments) } : fn
    var id = st.apply(null, [wrapped].concat(args)); __timers.push(id); return id
  }
  window.setInterval = function (fn) {
    var args = Array.prototype.slice.call(arguments, 1)
    var wrapped = typeof fn === 'function' ? function () { __markDirty(); return fn.apply(this, arguments) } : fn
    var id = si.apply(null, [wrapped].concat(args)); __intervals.push(id); return id
  }
  window.requestAnimationFrame = function (fn) {
    var id = rf(function (at) { __markDirty(); return fn(at) }); __rafs.push(id); return id
  }
  ;[window, document, document.documentElement, document.body].forEach(function (target) {
    var add = target.addEventListener.bind(target)
    target.addEventListener = function (type, listener, opts) {
      // React delegates selectionchange to the document once per app; removing
      // it would break inputs on the next mount.
      if (!(target === document && type === 'selectionchange')) {
        __listeners.push([target, type, listener, opts])
      }
      return add(type, listener, opts)
    }
  })
}
function __clearPayloadGlobals() {
  __timers.splice(0).forEach(function (id) { clearTimeout(id) })
  __intervals.splice(0).forEach(function (id) { clearInterval(id) })
  __rafs.splice(0).forEach(function (id) { cancelAnimationFrame(id) })
  __listeners.splice(0).forEach(function (l) {
    try { l[0].removeEventListener(l[1], l[2], l[3]) } catch (e) {}
  })
}

function __teardown() {
  if (__currentRoot) {
    try { __currentRoot.unmount() } catch (e) {}
    __currentRoot = null
  }
  __clearPayloadGlobals()
  // Logs from the torn-down payload would mislead the agent about current code.
  __logs.length = 0
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

window.addEventListener('message', function (e) {
  var msg = e.data
  if (!msg) return
  // Canvas snapshots can't see into the sandboxed iframe, so the frame
  // captures itself on request and posts the PNG back to the parent.
  if (msg.type === 'loora:capture') {
    var captureRevision = __revision
    var volatile = !!(document.getAnimations && document.getAnimations().some(function (animation) {
      return animation.playState === 'running' || animation.playState === 'pending'
    }))
    var reply = function (png) {
      parent.postMessage({
        type: 'loora:capture-result',
        token: msg.token,
        png: png,
        revision: captureRevision,
        volatile: volatile,
      }, '*')
      if (__revision === captureRevision) __dirty = false
      else __postDirty()
    }
    if (!window.htmlToImage) return reply(null)
    // Cross-origin stylesheets (fonts) can make font embedding throw; retry
    // without fonts before giving up.
    htmlToImage.toPng(document.body).catch(function () {
      return htmlToImage.toPng(document.body, { skipFonts: true })
    }).then(reply, function () { reply(null) })
    return
  }
  if (msg.type === 'loora:read-logs') {
    parent.postMessage({ type: 'loora:logs-result', token: msg.token, logs: __logs.slice() }, '*')
    return
  }
  if (msg.type !== 'loora:code' || typeof msg.code !== 'string') return
  __seq = msg.seq || 0
  try {
    if (msg.mode === 'html') {
      __mountHtml(msg.code)
    } else {
      __teardown()
      // Function scope: top-level const/let in the agent code would clash with
      // earlier payloads if evaluated in the global lexical environment.
      var App = new Function(msg.code + '\\n;return typeof App !== "undefined" ? App : null')()
      if (msg.needsEntry) {
        var Root = App || function () {
          return React.createElement('pre', { style: { padding: 10, fontSize: 11 } }, 'Code must define function App()')
        }
        ReactDOM.createRoot(__root).render(React.createElement(Root))
      }
    }
    __markDirty()
    parent.postMessage({ type: 'loora:ok', seq: __seq }, '*')
  } catch (err) {
    parent.postMessage(
      { type: 'loora:error', seq: __seq, message: String((err && err.message) || err) },
      '*',
    )
  }
})
__installPayloadTracking()
parent.postMessage({ type: 'loora:element-ready' }, '*')
<\/script>
</body>
</html>`
}

const ELEMENT_DOC = buildElementDoc()

// Sandboxed iframes have an opaque origin: an <img src="/api/asset/…"> inside
// one sends no session cookie and gets a 401. The parent document is
// authenticated, so it fetches each asset once and inlines it as a data URL
// before the code enters the iframe. Cached per asset URL for the session.
const assetDataUrls = new Map<string, Promise<string | null>>()

function assetToDataUrl(url: string): Promise<string | null> {
  let pending = assetDataUrls.get(url)
  if (!pending) {
    pending = (async () => {
      try {
        const res = await fetch(url)
        if (!res.ok) return null
        const blob = await res.blob()
        return await new Promise<string | null>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => resolve(null)
          reader.readAsDataURL(blob)
        })
      } catch {
        return null
      }
    })()
    assetDataUrls.set(url, pending)
  }
  return pending
}

export async function inlineAssetUrls(code: string): Promise<string> {
  const urls = [...new Set([...code.matchAll(/\/api\/asset\/[a-zA-Z0-9_-]+/g)].map((m) => m[0]))]
  if (urls.length === 0) return code
  const resolved = await Promise.all(urls.map(async (u) => [u, await assetToDataUrl(u)] as const))
  let out = code
  // Unresolvable assets keep their original URL (shows as a broken image
  // instead of silently vanishing).
  for (const [url, data] of resolved) if (data) out = out.split(url).join(data)
  return out
}

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
    if (!iframeRef.current?.contentWindow || !readyRef.current) return
    seqRef.current += 1
    const seq = seqRef.current
    void (async () => {
      let payload: FramePayload
      try {
        const babel = classifyCode(source) === 'html' ? null : await ensureBabel()
        if (seq !== seqRef.current) return
        const result = compileForFrame(source, babel)
        if (!result.ok) {
          reportRender(elementId, result.error)
          onErrorRef.current?.(result.error)
          return
        }
        payload = result.payload
      } catch {
        const message = 'The JSX compiler failed to load — check the connection and retry.'
        reportRender(elementId, message)
        onErrorRef.current?.(message)
        return
      }
      const inlined = await inlineAssetUrls(payload.code)
      // A newer payload was sent while compiling/inlining: drop this one.
      if (seq !== seqRef.current) return
      const win = iframeRef.current?.contentWindow
      if (!win) return
      noteFrameRevision(elementId)
      // sandbox iframes have an opaque origin: '*' required.
      win.postMessage(
        { type: 'loora:code', code: inlined, mode: payload.mode, seq, needsEntry: payload.needsEntry },
        '*',
      )
    })()
  }

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return
      const msg = e.data as { type?: string; seq?: number; message?: string; revision?: number } | null
      if (msg?.type === 'loora:element-ready') {
        readyRef.current = true
        send(codeRef.current)
        return
      }
      if (msg?.type === 'loora:dirty') {
        noteFrameRevision(elementId, msg.revision)
        return
      }
      // Stale replies (an old payload settling after a newer send) are ignored.
      if (msg?.type === 'loora:ok' && msg.seq === seqRef.current) {
        reportRender(elementId, null)
        onErrorRef.current?.(null)
      }
      if (msg?.type === 'loora:error' && msg.seq === seqRef.current) {
        const message = msg.message ?? 'Element failed to render'
        reportRender(elementId, message)
        onErrorRef.current?.(message)
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      frameRevisions.delete(elementId)
    }
  }, [])

  useEffect(() => {
    send(code)
  }, [code])

  return (
    <iframe
      ref={iframeRef}
      title="Element"
      sandbox="allow-scripts allow-forms allow-modals"
      srcDoc={ELEMENT_DOC}
      data-element-frame={elementId}
      className="h-full w-full border-0"
      style={{ pointerEvents: interactive ? 'auto' : 'none' }}
    />
  )
}

// Ask a mounted element iframe for a PNG of itself. Resolves null when the
// frame is missing, still booting, or slow to respond.
export interface ElementCapture {
  png: string
  revision: number
  volatile: boolean
}

// Ask a mounted element iframe for its runtime log buffer (console.error/warn
// and uncaught errors since the last code payload). Null when the frame is
// missing or unresponsive.
export function readElementLogs(elementId: string, timeoutMs = 1000): Promise<string[] | null> {
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
      const msg = e.data as { type?: string; token?: string; logs?: unknown }
      if (e.source !== iframe.contentWindow || msg?.type !== 'loora:logs-result' || msg.token !== token) return
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      resolve(Array.isArray(msg.logs) ? msg.logs.filter((l): l is string => typeof l === 'string') : [])
    }
    window.addEventListener('message', onMessage)
    iframe.contentWindow!.postMessage({ type: 'loora:read-logs', token }, '*')
  })
}

export function captureElement(elementId: string, timeoutMs = 1500): Promise<ElementCapture | null> {
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
      const msg = e.data as {
        type?: string
        token?: string
        png?: string | null
        revision?: number
        volatile?: boolean
      }
      if (e.source !== iframe.contentWindow || msg?.type !== 'loora:capture-result' || msg.token !== token) return
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      if (typeof msg.png !== 'string') return resolve(null)
      const revision = typeof msg.revision === 'number' ? msg.revision : getElementCaptureRevision(elementId)
      noteFrameRevision(elementId, revision)
      resolve({ png: msg.png, revision, volatile: msg.volatile === true })
    }
    window.addEventListener('message', onMessage)
    iframe.contentWindow!.postMessage({ type: 'loora:capture', token }, '*')
  })
}
