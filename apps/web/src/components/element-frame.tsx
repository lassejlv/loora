import { useEffect, useRef } from 'react'

// Sandboxed renderer for canvas elements. Every element is code — plain
// HTML/CSS/JS or JSX/TSX defining App — running in an iframe with React and
// Tailwind (vendored, same-origin).
//
// JSX compiles in the PARENT context with a single shared Babel instance
// (lazy-loaded once; in a worker when available so streamed re-compiles don't
// jank the canvas), so each iframe only boots React + Tailwind instead of
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
  // May be sync (main-thread Babel, tests) or async (compile worker).
  transform: (
    code: string,
    options: Record<string, unknown>,
  ) => { code?: string | null } | Promise<{ code?: string | null }>
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

// ---------------------------------------------------------------------------
// Compile worker: Babel transforms are CPU-heavy (a streamed element re-compiles
// its full source every ~250ms), so run them off the main thread. The worker
// loads the same vendored Babel via importScripts; when workers are unavailable
// or the vendor script fails to load there, compilation falls back to the
// main-thread Babel so behavior is identical, just slower.

interface PendingTransform {
  resolve: (out: { code?: string | null }) => void
  reject: (error: Error) => void
}

let compilerPromise: Promise<BabelLike> | null = null

function babelWorkerSource(): string {
  const babelUrl = new URL('/vendor/babel.js', location.origin).href
  return [
    'var ok = true',
    `try { importScripts(${JSON.stringify(babelUrl)}) } catch (e) { ok = false }`,
    "postMessage({ ready: ok && typeof Babel !== 'undefined' })",
    'onmessage = function (e) {',
    '  var m = e.data',
    '  try {',
    '    var out = Babel.transform(m.code, m.options)',
    '    postMessage({ id: m.id, code: out && out.code })',
    '  } catch (err) {',
    '    postMessage({ id: m.id, error: String((err && err.message) || err) })',
    '  }',
    '}',
  ].join('\n')
}

function createWorkerBabel(): Promise<BabelLike> {
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(URL.createObjectURL(new Blob([babelWorkerSource()], { type: 'text/javascript' })))
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Worker creation failed'))
      return
    }
    const pending = new Map<number, PendingTransform>()
    let nextId = 1
    const failAll = (message: string) => {
      for (const p of pending.values()) p.reject(new Error(message))
      pending.clear()
    }
    const readyTimer = setTimeout(() => {
      worker.terminate()
      reject(new Error('The compile worker did not start'))
    }, 10_000)
    worker.onerror = () => {
      clearTimeout(readyTimer)
      failAll('The compile worker crashed')
      reject(new Error('The compile worker crashed'))
    }
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as { ready?: boolean; id?: number; code?: string | null; error?: string }
      if (typeof msg?.ready === 'boolean') {
        clearTimeout(readyTimer)
        if (!msg.ready) {
          worker.terminate()
          reject(new Error('The compile worker failed to load Babel'))
          return
        }
        resolve({
          transform: (code, options) =>
            new Promise((res, rej) => {
              const id = nextId++
              pending.set(id, { resolve: res, reject: rej })
              worker.postMessage({ id, code, options })
            }),
        })
        return
      }
      if (typeof msg?.id !== 'number') return
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (typeof msg.error === 'string') p.reject(new Error(msg.error))
      else p.resolve({ code: msg.code })
    }
  })
}

/** Babel off the main thread when possible, main-thread Babel otherwise. */
export function ensureCompiler(): Promise<BabelLike> {
  if (!compilerPromise) {
    compilerPromise =
      typeof Worker === 'undefined'
        ? ensureBabel()
        : createWorkerBabel().catch(() => ensureBabel())
    compilerPromise.catch(() => {
      compilerPromise = null
    })
  }
  return compilerPromise
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

async function transform(babel: BabelLike, source: string, withTypescript: boolean): Promise<string> {
  const presets: unknown[] = withTypescript
    ? [['react', {}], ['typescript', { isTSX: true, allExtensions: true }]]
    : [['react', {}]]
  const out = await babel.transform(source, { presets })
  if (typeof out?.code !== 'string') throw new Error('Compilation produced no output')
  return out.code
}

/**
 * Compile a raw code payload into what the frame runtime executes.
 * Pure so it is unit-testable; `babel` may be null for html-only payloads.
 * TSX is tried first (agents write TypeScript constantly); plain-React is the
 * fallback in case the TypeScript preset chokes on valid JSX.
 */
export async function compileForFrame(source: string, babel: BabelLike | null): Promise<CompileResult> {
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
      compiled = await transform(babel, jsxSource, true)
    } catch (tsError) {
      try {
        compiled = await transform(babel, jsxSource, false)
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

// Latest compile/runtime outcome for an element — powers the user-facing
// element console (the agent gets the same data through awaitRenderResult).
export function getRenderResult(elementId: string): { error: string | null; at: number } | null {
  return renderResults.get(elementId) ?? null
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
var __suspended = false
var __rafQueue = []
var __rafSeq = 0
var __pausedAnimations = []

// Elements are isolated documents; window.loora is the cross-element message
// bus (relayed through the parent, see loora:bus below).
var __busHandlers = []
window.loora = {
  send: function (data) { parent.postMessage({ type: 'loora:bus', data: data }, '*') },
  onMessage: function (fn) {
    if (typeof fn === 'function') __busHandlers.push(fn)
    return function () { __busHandlers = __busHandlers.filter(function (h) { return h !== fn }) }
  },
}

// Offscreen suspension: CSS/WAAPI animations pause and payload rAF callbacks
// queue instead of scheduling, so an animated element scrolled out of view
// stops burning CPU. DOM state is left intact so captures still work.
function __pauseAnimations() {
  try {
    document.getAnimations().forEach(function (a) {
      if (a.playState === 'running') { a.pause(); __pausedAnimations.push(a) }
    })
  } catch (e) {}
}
function __applySuspend(next) {
  if (next === __suspended) return
  __suspended = next
  if (next) {
    __pauseAnimations()
  } else {
    __pausedAnimations.splice(0).forEach(function (a) { try { a.play() } catch (e) {} })
    __rafQueue.splice(0).forEach(function (item) { window.requestAnimationFrame(item.fn) })
  }
}

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

// Inline text editing: in edit mode a click makes the nearest text-bearing
// node contenteditable; committing diffs its text nodes against their
// original content and posts before/after pairs. The PARENT maps them onto
// the source code with exact search/replace — the frame never rewrites code.
var __editMode = false
var __editSession = null
var __editHover = null

function __findTextHost(start) {
  var host = start && start.nodeType === 1 ? start : null
  while (host && host !== document.body) {
    var nodes = host.childNodes
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].nodeType === 3 && nodes[i].textContent.trim()) return host
    }
    host = host.parentElement
  }
  return null
}

function __clearEditHover() {
  if (!__editHover) return
  __editHover.el.style.outline = __editHover.prev
  __editHover = null
}

function __collectTexts(host) {
  var texts = []
  ;(function walk(n) {
    for (var i = 0; i < n.childNodes.length; i++) {
      var c = n.childNodes[i]
      if (c.nodeType === 3) texts.push([c, c.textContent])
      else if (c.nodeType === 1) walk(c)
    }
  })(host)
  return texts
}

function __endEditSession(apply) {
  var s = __editSession
  if (!s) return
  __editSession = null
  s.host.removeAttribute('contenteditable')
  s.host.style.outline = s.prevOutline
  if (!apply) {
    // Cancel: restore every text node we snapshotted.
    s.texts.forEach(function (pair) {
      if (pair[0].isConnected) pair[0].textContent = pair[1]
    })
    return
  }
  var edits = []
  s.texts.forEach(function (pair) {
    if (pair[0].isConnected && pair[0].textContent !== pair[1]) {
      edits.push({ before: pair[1], after: pair[0].textContent })
    }
  })
  if (edits.length) parent.postMessage({ type: 'loora:text-edit', edits: edits }, '*')
}

function __startEditSession(host) {
  __endEditSession(true)
  __clearEditHover()
  __editSession = { host: host, texts: __collectTexts(host), prevOutline: host.style.outline }
  host.setAttribute('contenteditable', 'plaintext-only')
  // Firefox does not support plaintext-only; fall back to true.
  if (!host.isContentEditable) host.setAttribute('contenteditable', 'true')
  host.style.outline = '2px solid #2440e6'
  host.focus()
}

function __setEditMode(on) {
  if (on === __editMode) return
  __editMode = on
  document.body.style.cursor = on ? 'text' : ''
  if (!on) {
    __endEditSession(true)
    __clearEditHover()
  }
}

function __findEditTarget(start) {
  // Images swap via the parent's asset picker; anything else edits its text.
  var img = start && start.closest ? start.closest('img') : null
  if (img) return img
  return __findTextHost(start)
}

document.addEventListener('mouseover', function (e) {
  if (!__editMode || __editSession) return
  var host = __findEditTarget(e.target)
  if (__editHover && __editHover.el === host) return
  __clearEditHover()
  if (host) {
    __editHover = { el: host, prev: host.style.outline }
    host.style.outline = '1.5px dashed #2440e6'
  }
}, true)

// Capture phase so edit-mode clicks never reach buttons/links in the page.
document.addEventListener('click', function (e) {
  if (!__editMode) return
  if (__editSession && __editSession.host.contains(e.target)) return
  e.preventDefault()
  e.stopPropagation()
  var img = e.target && e.target.closest ? e.target.closest('img') : null
  if (img) {
    __endEditSession(true)
    parent.postMessage({ type: 'loora:image-pick', src: img.getAttribute('src') || '' }, '*')
    return
  }
  var host = __findTextHost(e.target)
  if (host) __startEditSession(host)
  else __endEditSession(true)
}, true)

document.addEventListener('focusout', function (e) {
  if (__editSession && e.target === __editSession.host) {
    // Let a click inside the session settle first.
    var s = __editSession
    setTimeout(function () { if (__editSession === s) __endEditSession(true) }, 0)
  }
}, true)

document.addEventListener('keydown', function (e) {
  if (!__editSession) return
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    e.stopPropagation()
    __endEditSession(true)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    __endEditSession(false)
  }
}, true)

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
    if (__suspended) { var sid = -(++__rafSeq); __rafQueue.push({ id: sid, fn: fn }); return sid }
    var id = rf(function (at) { __markDirty(); return fn(at) }); __rafs.push(id); return id
  }
  var caf = window.cancelAnimationFrame.bind(window)
  window.cancelAnimationFrame = function (id) {
    if (id < 0) { __rafQueue = __rafQueue.filter(function (item) { return item.id !== id }); return }
    return caf(id)
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
  __rafQueue.length = 0
  __pausedAnimations.length = 0
  __listeners.splice(0).forEach(function (l) {
    try { l[0].removeEventListener(l[1], l[2], l[3]) } catch (e) {}
  })
}

function __teardown() {
  // A new payload replaces the DOM the session pointed at; drop it silently.
  __editSession = null
  __clearEditHover()
  if (__currentRoot) {
    try { __currentRoot.unmount() } catch (e) {}
    __currentRoot = null
  }
  __clearPayloadGlobals()
  // Logs from the torn-down payload would mislead the agent about current code.
  __logs.length = 0
  __busHandlers = []
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
    var reply = function (png, fontsSkipped) {
      parent.postMessage({
        type: 'loora:capture-result',
        token: msg.token,
        png: png,
        revision: captureRevision,
        volatile: volatile,
        fontsSkipped: !!fontsSkipped,
      }, '*')
      if (__revision === captureRevision) __dirty = false
      else __postDirty()
    }
    if (!window.htmlToImage) return reply(null)
    // Capture at device resolution (capped at 2x) so the agent judges text
    // and detail from a sharp image. Cross-origin stylesheets (fonts) can
    // make font embedding throw; retry without fonts before giving up, and
    // flag the reply so the degraded fidelity is visible downstream.
    var pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    htmlToImage.toPng(document.body, { pixelRatio: pixelRatio }).then(
      function (png) { reply(png, false) },
      function () {
        htmlToImage.toPng(document.body, { pixelRatio: pixelRatio, skipFonts: true }).then(
          function (png) { reply(png, true) },
          function () { reply(null, false) }
        )
      }
    )
    return
  }
  if (msg.type === 'loora:suspend') { __applySuspend(true); return }
  if (msg.type === 'loora:resume') { __applySuspend(false); return }
  if (msg.type === 'loora:edit-mode') { __setEditMode(!!msg.on); return }
  if (msg.type === 'loora:bus-deliver') {
    __busHandlers.forEach(function (fn) { try { fn(msg.data, msg.from) } catch (e) {} })
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
    // Code that mounted while suspended starts its CSS animations running;
    // re-pause once styles have applied.
    if (__suspended) window.setTimeout(__pauseAnimations, 50)
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
// Reverse map: inlined data URL → the /api/asset/… url that appears in the
// SOURCE code, so a src reported from inside a frame (e.g. an image click in
// edit mode) can be located in the code again.
const inlinedSrcToSourceUrl = new Map<string, string>()

export function sourceUrlForInlinedSrc(src: string): string {
  return inlinedSrcToSourceUrl.get(src) ?? src
}

function assetToDataUrl(url: string): Promise<string | null> {
  let pending = assetDataUrls.get(url)
  if (!pending) {
    pending = (async () => {
      try {
        const res = await fetch(url)
        if (!res.ok) return null
        const blob = await res.blob()
        const data = await new Promise<string | null>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => resolve(null)
          reader.readAsDataURL(blob)
        })
        if (data) inlinedSrcToSourceUrl.set(data, url)
        return data
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

export interface FrameTextEdit {
  before: string
  after: string
}

export function ElementFrame({
  elementId,
  code,
  interactive,
  suspended = false,
  textEditable = false,
  onError,
  onTextEdit,
  onImagePick,
}: {
  elementId: string
  code: string
  interactive: boolean
  // Offscreen: the frame pauses animations and queues rAF work (state kept).
  suspended?: boolean
  // Inline text editing: clicks select text-bearing nodes instead of
  // interacting; commits arrive via onTextEdit as before/after text pairs
  // for the caller to map onto the source code. Clicking an <img> reports
  // its source-code src via onImagePick instead (inlined data URLs are
  // mapped back to their /api/asset/… form).
  textEditable?: boolean
  // Called with a message when the latest payload failed, null when it rendered.
  onError?: (message: string | null) => void
  onTextEdit?: (edits: FrameTextEdit[]) => void
  onImagePick?: (src: string) => void
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const readyRef = useRef(false)
  const codeRef = useRef(code)
  codeRef.current = code
  const seqRef = useRef(0)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const suspendedRef = useRef(suspended)
  suspendedRef.current = suspended
  const textEditableRef = useRef(textEditable)
  textEditableRef.current = textEditable
  const onTextEditRef = useRef(onTextEdit)
  onTextEditRef.current = onTextEdit
  const onImagePickRef = useRef(onImagePick)
  onImagePickRef.current = onImagePick

  const send = (source: string) => {
    if (!iframeRef.current?.contentWindow || !readyRef.current) return
    seqRef.current += 1
    const seq = seqRef.current
    void (async () => {
      let payload: FramePayload
      try {
        const babel = classifyCode(source) === 'html' ? null : await ensureCompiler()
        if (seq !== seqRef.current) return
        const result = await compileForFrame(source, babel)
        if (seq !== seqRef.current) return
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
        if (suspendedRef.current) {
          iframeRef.current?.contentWindow?.postMessage({ type: 'loora:suspend' }, '*')
        }
        if (textEditableRef.current) {
          iframeRef.current?.contentWindow?.postMessage({ type: 'loora:edit-mode', on: true }, '*')
        }
        return
      }
      if (msg?.type === 'loora:text-edit') {
        const raw = (msg as { edits?: unknown }).edits
        const edits = Array.isArray(raw)
          ? raw.filter(
              (e): e is FrameTextEdit =>
                !!e && typeof (e as FrameTextEdit).before === 'string' && typeof (e as FrameTextEdit).after === 'string',
            )
          : []
        if (edits.length) onTextEditRef.current?.(edits)
        return
      }
      if (msg?.type === 'loora:image-pick') {
        const src = (msg as { src?: unknown }).src
        if (typeof src === 'string') onImagePickRef.current?.(sourceUrlForInlinedSrc(src))
        return
      }
      if (msg?.type === 'loora:dirty') {
        noteFrameRevision(elementId, msg.revision)
        return
      }
      // Cross-element bus: fan a frame's loora.send out to every other frame.
      if (msg?.type === 'loora:bus') {
        const data = (msg as { data?: unknown }).data
        for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe[data-element-frame]')) {
          if (frame === iframeRef.current) continue
          frame.contentWindow?.postMessage({ type: 'loora:bus-deliver', data, from: elementId }, '*')
        }
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

  useEffect(() => {
    if (!readyRef.current) return
    iframeRef.current?.contentWindow?.postMessage(
      { type: suspended ? 'loora:suspend' : 'loora:resume' },
      '*',
    )
  }, [suspended])

  useEffect(() => {
    if (!readyRef.current) return
    iframeRef.current?.contentWindow?.postMessage({ type: 'loora:edit-mode', on: textEditable }, '*')
  }, [textEditable])

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
  // True when font embedding failed and the capture rendered without webfonts.
  fontsSkipped: boolean
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
        fontsSkipped?: boolean
      }
      if (e.source !== iframe.contentWindow || msg?.type !== 'loora:capture-result' || msg.token !== token) return
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      if (typeof msg.png !== 'string') return resolve(null)
      const revision = typeof msg.revision === 'number' ? msg.revision : getElementCaptureRevision(elementId)
      noteFrameRevision(elementId, revision)
      resolve({
        png: msg.png,
        revision,
        volatile: msg.volatile === true,
        fontsSkipped: msg.fontsSkipped === true,
      })
    }
    window.addEventListener('message', onMessage)
    iframe.contentWindow!.postMessage({ type: 'loora:capture', token }, '*')
  })
}
