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

// html-to-image otherwise copies every computed property onto every cloned
// element. Chromium exposes hundreds of properties, which can turn a normal
// legacy page into a multi-megabyte SVG data URL that the browser cannot
// decode. Keep the visual properties that affect a static canvas capture.
export const CAPTURE_STYLE_PROPERTIES = [
  '-webkit-background-clip',
  '-webkit-box-reflect',
  '-webkit-line-clamp',
  '-webkit-mask-clip',
  '-webkit-mask-composite',
  '-webkit-mask-image',
  '-webkit-mask-origin',
  '-webkit-mask-position',
  '-webkit-mask-repeat',
  '-webkit-mask-size',
  '-webkit-text-fill-color',
  '-webkit-text-stroke-color',
  '-webkit-text-stroke-width',
  'align-content',
  'align-items',
  'align-self',
  'animation-delay',
  'animation-direction',
  'animation-duration',
  'animation-fill-mode',
  'animation-iteration-count',
  'animation-name',
  'animation-play-state',
  'animation-timing-function',
  'appearance',
  'aspect-ratio',
  'backdrop-filter',
  'backface-visibility',
  'background-attachment',
  'background-blend-mode',
  'background-clip',
  'background-color',
  'background-image',
  'background-origin',
  'background-position',
  'background-repeat',
  'background-size',
  'border-bottom-color',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'border-bottom-style',
  'border-bottom-width',
  'border-collapse',
  'border-left-color',
  'border-left-style',
  'border-left-width',
  'border-right-color',
  'border-right-style',
  'border-right-width',
  'border-spacing',
  'border-top-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-top-style',
  'border-top-width',
  'bottom',
  'box-decoration-break',
  'box-shadow',
  'box-sizing',
  'break-after',
  'break-before',
  'break-inside',
  'caption-side',
  'clear',
  'clip',
  'clip-path',
  'color',
  'color-scheme',
  'column-count',
  'column-fill',
  'column-gap',
  'column-rule-color',
  'column-rule-style',
  'column-rule-width',
  'column-span',
  'column-width',
  'contain',
  'contain-intrinsic-size',
  'content',
  'content-visibility',
  'direction',
  'display',
  'fill',
  'fill-opacity',
  'fill-rule',
  'filter',
  'flex-basis',
  'flex-direction',
  'flex-grow',
  'flex-shrink',
  'flex-wrap',
  'float',
  'font-family',
  'font-feature-settings',
  'font-kerning',
  'font-optical-sizing',
  'font-size',
  'font-stretch',
  'font-style',
  'font-variant',
  'font-variation-settings',
  'font-weight',
  'grid-auto-columns',
  'grid-auto-flow',
  'grid-auto-rows',
  'grid-column-end',
  'grid-column-start',
  'grid-row-end',
  'grid-row-start',
  'grid-template-areas',
  'grid-template-columns',
  'grid-template-rows',
  'height',
  'hyphens',
  'image-rendering',
  'isolation',
  'justify-content',
  'justify-items',
  'justify-self',
  'left',
  'letter-spacing',
  'line-break',
  'line-height',
  'list-style-image',
  'list-style-position',
  'list-style-type',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'margin-top',
  'mask-border',
  'mask-clip',
  'mask-composite',
  'mask-image',
  'mask-mode',
  'mask-origin',
  'mask-position',
  'mask-repeat',
  'mask-size',
  'max-height',
  'max-width',
  'min-height',
  'min-width',
  'mix-blend-mode',
  'object-fit',
  'object-position',
  'opacity',
  'order',
  'outline-color',
  'outline-offset',
  'outline-style',
  'outline-width',
  'overflow-wrap',
  'overflow-x',
  'overflow-y',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'padding-top',
  'paint-order',
  'perspective',
  'perspective-origin',
  'place-content',
  'place-items',
  'place-self',
  'position',
  'right',
  'rotate',
  'row-gap',
  'scale',
  'shape-image-threshold',
  'shape-margin',
  'shape-outside',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'table-layout',
  'tab-size',
  'text-align',
  'text-align-last',
  'text-decoration-color',
  'text-decoration-line',
  'text-decoration-style',
  'text-decoration-thickness',
  'text-emphasis-color',
  'text-emphasis-position',
  'text-emphasis-style',
  'text-indent',
  'text-overflow',
  'text-rendering',
  'text-shadow',
  'text-transform',
  'text-underline-offset',
  'text-underline-position',
  'top',
  'transform',
  'transform-box',
  'transform-origin',
  'transform-style',
  'transition-delay',
  'transition-duration',
  'transition-property',
  'transition-timing-function',
  'translate',
  'unicode-bidi',
  'vertical-align',
  'visibility',
  'white-space',
  'width',
  'word-break',
  'word-spacing',
  'writing-mode',
  'z-index',
] as const

// Families available inside every legacy frame (and offered by the style
// editor's font row). Regenerate with scripts/vendor-fonts.py.
// Data-URL variant: element frames are sandboxed without allow-same-origin, so
// their font fetches carry Origin: null and a plain same-origin woff2 would be
// refused by CORS.
export const FRAME_FONTS_URL = '/vendor/fonts-sandbox.css'

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
<link rel="stylesheet" href="${FRAME_FONTS_URL}" />
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

// An emptied style attribute must go away entirely: a leftover style="" would
// make the node's outerHTML stop matching the source code.
function __dropEmptyStyle(el) {
  if (el.getAttribute && el.getAttribute('style') === '') el.removeAttribute('style')
}

function __clearEditHover() {
  if (!__editHover) return
  __editHover.el.style.outline = __editHover.prev
  __dropEmptyStyle(__editHover.el)
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
  __dropEmptyStyle(s.host)
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
    __dragCleanup()
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
  if (__justDragged) {
    __justDragged = false
    e.preventDefault()
    e.stopPropagation()
    return
  }
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

// Drag-reorder in edit mode: press and move >6px on a node to drag it among
// its siblings; a drop posts the dragged node's and target sibling's
// outerHTML so the parent can move the markup in the source. Plain clicks
// (no movement) still start a text-edit session.
var __nodeDrag = null
var __justDragged = false

function __findDraggable(start) {
  var n = start && start.nodeType === 1 ? start : start && start.parentElement
  while (n && n !== document.body && n !== document.documentElement) {
    var p = n.parentElement
    if (p && p !== document.documentElement && p.children.length > 1) return n
    n = n.parentElement
  }
  return null
}

function __dragCleanup() {
  var d = __nodeDrag
  if (!d) return
  __nodeDrag = null
  if (d.active) {
    d.node.style.opacity = d.prevOpacity
    __dropEmptyStyle(d.node)
    document.body.style.userSelect = d.prevSelect
    if (d.marker.parentNode) d.marker.parentNode.removeChild(d.marker)
  }
}

function __dragTarget(d, x, y) {
  // Nearest sibling gap: horizontal for flex rows, vertical otherwise.
  var parent = d.node.parentElement
  if (!parent) return null
  var style = getComputedStyle(parent)
  var horizontal = style.display.indexOf('flex') !== -1 && style.flexDirection.indexOf('row') === 0
  var best = null
  for (var i = 0; i < parent.children.length; i++) {
    var sib = parent.children[i]
    if (sib === d.node || sib === d.marker) continue
    var rect = sib.getBoundingClientRect()
    var center = horizontal ? rect.left + rect.width / 2 : rect.top + rect.height / 2
    var pointer = horizontal ? x : y
    var dist = Math.abs(pointer - center)
    if (!best || dist < best.dist) {
      best = { sib: sib, dist: dist, position: pointer < center ? 'before' : 'after', rect: rect, horizontal: horizontal }
    }
  }
  return best
}

function __dragMark(target) {
  var d = __nodeDrag
  if (!d || !target) return
  var m = d.marker
  var r = target.rect
  if (target.horizontal) {
    m.style.left = (target.position === 'before' ? r.left - 3 : r.right + 1) + 'px'
    m.style.top = r.top + 'px'
    m.style.width = '2px'
    m.style.height = r.height + 'px'
  } else {
    m.style.left = r.left + 'px'
    m.style.top = (target.position === 'before' ? r.top - 3 : r.bottom + 1) + 'px'
    m.style.width = r.width + 'px'
    m.style.height = '2px'
  }
  if (!m.parentNode) document.body.appendChild(m)
}

document.addEventListener('pointerdown', function (e) {
  if (!__editMode || e.button !== 0) return
  if (__editSession && __editSession.host.contains(e.target)) return
  var node = __findDraggable(e.target)
  if (!node) return
  var marker = document.createElement('div')
  marker.style.cssText = 'position:fixed;z-index:2147483647;background:#2440e6;border-radius:2px;pointer-events:none'
  __nodeDrag = { node: node, startX: e.clientX, startY: e.clientY, active: false, marker: marker, prevOpacity: '', prevSelect: '', target: null }
}, true)

document.addEventListener('pointermove', function (e) {
  var d = __nodeDrag
  if (!d) return
  if (!d.active) {
    if (Math.abs(e.clientX - d.startX) < 6 && Math.abs(e.clientY - d.startY) < 6) return
    d.active = true
    d.prevOpacity = d.node.style.opacity
    d.prevSelect = document.body.style.userSelect
    d.node.style.opacity = '0.4'
    document.body.style.userSelect = 'none'
  }
  d.target = __dragTarget(d, e.clientX, e.clientY)
  __dragMark(d.target)
}, true)

document.addEventListener('pointerup', function () {
  var d = __nodeDrag
  if (!d) return
  var drop = d.active && d.target ? d.target : null
  var wasActive = d.active
  __dragCleanup()
  if (wasActive) __justDragged = true
  if (drop) {
    parent.postMessage({
      type: 'loora:node-move',
      node: d.node.outerHTML,
      anchor: drop.sib.outerHTML,
      position: drop.position,
    }, '*')
  }
}, true)

document.addEventListener('pointercancel', function () { __dragCleanup() }, true)
document.addEventListener('dragstart', function (e) { if (__editMode) e.preventDefault() }, true)

// Right-click in edit mode: report the node's tag + class value so the
// parent can open the style editor (the class string is what appears in the
// source code, so token swaps map back with exact replace).
document.addEventListener('contextmenu', function (e) {
  if (!__editMode) return
  e.preventDefault()
  e.stopPropagation()
  var t = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement
  if (!t || t === document.documentElement || t === document.body) return
  __endEditSession(true)
  // Clear the hover outline BEFORE serializing — its inline style would make
  // the outerHTML stop matching the source.
  __clearEditHover()
  parent.postMessage({
    type: 'loora:style-pick',
    tag: t.tagName.toLowerCase(),
    className: t.getAttribute('class') || '',
    node: t.outerHTML,
  }, '*')
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
  __dragCleanup()
  __justDragged = false
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
    var reply = function (png, fontsSkipped, captureError) {
      parent.postMessage({
        type: 'loora:capture-result',
        token: msg.token,
        png: png,
        error: captureError || null,
        revision: captureRevision,
        volatile: volatile,
        fontsSkipped: !!fontsSkipped,
      }, '*')
      if (__revision === captureRevision) __dirty = false
      else __postDirty()
    }
    var captureErrorMessage = function (error) {
      return String((error && error.message) || error || 'Unknown browser capture error').slice(0, 500)
    }
    if (!window.htmlToImage) {
      return reply(null, false, 'The legacy image capture runtime did not load')
    }
    // Capture at device resolution (capped at 2x) so the agent judges text
    // and detail from a sharp image. A bounded style list keeps the cloned SVG
    // below browser data-URI limits. Cross-origin stylesheets (fonts) can make
    // font embedding throw, so retry without fonts before giving up.
    var pixelRatio = typeof msg.pixelRatio === 'number' && msg.pixelRatio > 0
      ? msg.pixelRatio
      : Math.min(window.devicePixelRatio || 1, 2)
    var captureWidth = Math.max(
      1,
      document.body.scrollWidth,
      document.documentElement.scrollWidth
    )
    var captureHeight = Math.max(
      1,
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    )
    var maxDimension = typeof msg.maxDimension === 'number' && msg.maxDimension > 0
      ? msg.maxDimension
      : Math.max(captureWidth, captureHeight)
    var captureScale = Math.min(
      1,
      maxDimension / Math.max(captureWidth, captureHeight)
    )
    var scaledCaptureWidth = Math.max(1, Math.round(captureWidth * captureScale))
    var scaledCaptureHeight = Math.max(1, Math.round(captureHeight * captureScale))
    var captureStyleProperties = ${JSON.stringify(CAPTURE_STYLE_PROPERTIES)}
    var captureOptions = function (skipFonts) {
      var options = {
        pixelRatio: pixelRatio,
        includeStyleProperties: captureStyleProperties,
        fontEmbedCSS: msg.fontEmbedCSS,
        skipFonts: !!skipFonts,
      }
      if (captureScale < 1) {
        options.width = scaledCaptureWidth
        options.height = scaledCaptureHeight
        options.canvasWidth = scaledCaptureWidth
        options.canvasHeight = scaledCaptureHeight
        options.style = {
          width: captureWidth + 'px',
          height: captureHeight + 'px',
          transform: 'scale(' + captureScale + ')',
          transformOrigin: 'top left',
        }
      }
      return options
    }
    htmlToImage.toPng(document.body, captureOptions(false)).then(
      function (png) { reply(png, false, null) },
      function (firstCaptureError) {
        htmlToImage.toPng(document.body, captureOptions(true)).then(
          function (png) { reply(png, true, null) },
          function (retryCaptureError) {
            var captureError =
              'PNG capture failed: ' + captureErrorMessage(firstCaptureError) +
              '; retry without fonts failed: ' + captureErrorMessage(retryCaptureError)
            console.error(captureError)
            reply(null, false, captureError)
          }
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
  if (msg.type === 'loora:measure') {
    // Natural content size. html/body are pinned to 100% height, so
    // scrollHeight only ever EXCEEDS the frame when content overflows —
    // content shorter than the frame is not detectable from here.
    parent.postMessage({
      type: 'loora:measure-result',
      token: msg.token,
      w: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
      h: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
    }, '*')
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
  frameId = elementId,
  code,
  interactive,
  suspended = false,
  textEditable = false,
  onError,
  onTextEdit,
  onImagePick,
  onStylePick,
  onNodeMove,
}: {
  // Source element identity. Composed Page instances may share this.
  elementId: string
  // Runtime identity for capture, logs and iframe messages.
  frameId?: string
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
  // Right-click on a node in edit mode: its tag, class attribute value, and
  // outerHTML (for structural actions — delete, duplicate, add section).
  onStylePick?: (pick: { tag: string; className: string; node: string }) => void
  // Drag-reorder drop in edit mode: dragged node's and target sibling's
  // outerHTML plus which side to insert on.
  onNodeMove?: (move: { node: string; anchor: string; position: 'before' | 'after' }) => void
}) {
  const runtimeId = frameId
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
  const onStylePickRef = useRef(onStylePick)
  onStylePickRef.current = onStylePick
  const onNodeMoveRef = useRef(onNodeMove)
  onNodeMoveRef.current = onNodeMove

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
          reportRender(runtimeId, result.error)
          onErrorRef.current?.(result.error)
          return
        }
        payload = result.payload
      } catch {
        const message = 'The JSX compiler failed to load — check the connection and retry.'
        reportRender(runtimeId, message)
        onErrorRef.current?.(message)
        return
      }
      const inlined = await inlineAssetUrls(payload.code)
      // A newer payload was sent while compiling/inlining: drop this one.
      if (seq !== seqRef.current) return
      const win = iframeRef.current?.contentWindow
      if (!win) return
      noteFrameRevision(runtimeId)
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
      if (msg?.type === 'loora:style-pick') {
        const pick = msg as { tag?: unknown; className?: unknown; node?: unknown }
        if (typeof pick.tag === 'string' && typeof pick.className === 'string') {
          onStylePickRef.current?.({
            tag: pick.tag,
            className: pick.className,
            node: typeof pick.node === 'string' ? pick.node : '',
          })
        }
        return
      }
      if (msg?.type === 'loora:node-move') {
        const move = msg as { node?: unknown; anchor?: unknown; position?: unknown }
        if (
          typeof move.node === 'string' &&
          typeof move.anchor === 'string' &&
          (move.position === 'before' || move.position === 'after')
        ) {
          onNodeMoveRef.current?.({ node: move.node, anchor: move.anchor, position: move.position })
        }
        return
      }
      if (msg?.type === 'loora:dirty') {
        noteFrameRevision(runtimeId, msg.revision)
        return
      }
      // Cross-element bus: fan a frame's loora.send out to every other frame.
      if (msg?.type === 'loora:bus') {
        const data = (msg as { data?: unknown }).data
        for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe[data-element-frame]')) {
          if (frame === iframeRef.current) continue
          frame.contentWindow?.postMessage({ type: 'loora:bus-deliver', data, from: runtimeId }, '*')
        }
        return
      }
      // Stale replies (an old payload settling after a newer send) are ignored.
      if (msg?.type === 'loora:ok' && msg.seq === seqRef.current) {
        reportRender(runtimeId, null)
        onErrorRef.current?.(null)
      }
      if (msg?.type === 'loora:error' && msg.seq === seqRef.current) {
        const message = msg.message ?? 'Element failed to render'
        reportRender(runtimeId, message)
        onErrorRef.current?.(message)
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      frameRevisions.delete(runtimeId)
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
      data-element-frame={runtimeId}
      data-source-element={elementId}
      className="h-full w-full border-0"
      style={{ pointerEvents: interactive ? 'auto' : 'none' }}
    />
  )
}

// Ask a mounted element iframe for a PNG of itself. Resolves null when the
// frame is missing, still booting, or slow to respond.
export interface ElementCapture {
  png: string | null
  error: string | null
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

// Ask a mounted frame for its natural content size (scroll dimensions).
// Null when the frame is missing or unresponsive. Because the frame document
// fills the element box, a height LARGER than the element means the content
// overflows and is being clipped on the canvas.
export function measureElement(
  elementId: string,
  timeoutMs = 1000,
): Promise<{ w: number; h: number } | null> {
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
      const msg = e.data as { type?: string; token?: string; w?: unknown; h?: unknown }
      if (e.source !== iframe.contentWindow || msg?.type !== 'loora:measure-result' || msg.token !== token) return
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      resolve(
        typeof msg.w === 'number' && typeof msg.h === 'number'
          ? { w: Math.round(msg.w), h: Math.round(msg.h) }
          : null,
      )
    }
    window.addEventListener('message', onMessage)
    iframe.contentWindow!.postMessage({ type: 'loora:measure', token }, '*')
  })
}

export function captureElement(
  elementId: string,
  timeoutMs = 1500,
  options: {
    pixelRatio?: number
    maxDimension?: number
    fontEmbedCSS?: string
  } = {},
): Promise<ElementCapture | null> {
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
        error?: string | null
        revision?: number
        volatile?: boolean
        fontsSkipped?: boolean
      }
      if (e.source !== iframe.contentWindow || msg?.type !== 'loora:capture-result' || msg.token !== token) return
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      const revision = typeof msg.revision === 'number' ? msg.revision : getElementCaptureRevision(elementId)
      noteFrameRevision(elementId, revision)
      resolve({
        png: typeof msg.png === 'string' ? msg.png : null,
        error:
          typeof msg.error === 'string' && msg.error.trim()
            ? msg.error.slice(0, 500)
            : typeof msg.png === 'string'
              ? null
              : 'The browser returned no PNG data',
        revision,
        volatile: msg.volatile === true,
        fontsSkipped: msg.fontsSkipped === true,
      })
    }
    window.addEventListener('message', onMessage)
    iframe.contentWindow!.postMessage(
      {
        type: 'loora:capture',
        token,
        pixelRatio: options.pixelRatio,
        maxDimension: options.maxDimension,
        fontEmbedCSS: options.fontEmbedCSS,
      },
      '*',
    )
  })
}
