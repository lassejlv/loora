// jsdom deliberately ships without TypeScript declarations; this preload only
// uses its public JSDOM constructor.
// @ts-expect-error jsdom has no bundled declaration file
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
})

const browserGlobals = [
  'window',
  'document',
  'navigator',
  'location',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLTextAreaElement',
  'Element',
  'Node',
  'ShadowRoot',
  'Event',
  'MouseEvent',
  'PointerEvent',
  'KeyboardEvent',
  'FocusEvent',
  'FormData',
  'File',
  'FileList',
  'FileReader',
  'MutationObserver',
  'DOMParser',
  'XMLSerializer',
  'CSSStyleSheet',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
] as const

for (const key of browserGlobals) {
  const value = key === 'window' ? dom.window : dom.window[key]
  if (value === undefined) continue
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: typeof value === 'function' && key === 'getComputedStyle' ? value.bind(dom.window) : value,
  })
}

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  writable: true,
  value: true,
})

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  writable: true,
  value: TestResizeObserver,
})
Object.defineProperty(dom.window, 'ResizeObserver', {
  configurable: true,
  writable: true,
  value: TestResizeObserver,
})

if (!dom.window.Element.prototype.getAnimations) {
  Object.defineProperty(dom.window.Element.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  })
}
