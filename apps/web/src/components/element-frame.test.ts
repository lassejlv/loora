import { describe, expect, it, mock } from 'bun:test'
import {
  buildElementDoc,
  classifyCode,
  compileForFrame,
  hasEntryCall,
  inlineAssetUrls,
  CAPTURE_STYLE_PROPERTIES,
  REACT_GLOBALS_PRELUDE,
  stripModuleSyntax,
  type BabelLike,
} from './element-frame'

describe('stripModuleSyntax', () => {
  it('removes named imports', () => {
    const out = stripModuleSyntax(`import { useState } from 'react'\nfunction App() {}`)
    expect(out).not.toContain('import')
    expect(out).toContain('function App()')
  })

  it('removes default and namespace imports', () => {
    const out = stripModuleSyntax(
      `import React from 'react'\nimport * as icons from '@hugeicons/react'\nconst x = 1`,
    )
    expect(out).not.toContain('import')
    expect(out).toContain('const x = 1')
  })

  it('removes side-effect imports', () => {
    const out = stripModuleSyntax(`import './styles.css'\nconst x = 1`)
    expect(out).not.toContain('import')
  })

  it('unwraps export default function App', () => {
    const out = stripModuleSyntax('export default function App() { return null }')
    expect(out).toBe('function App() { return null }')
  })

  it('unwraps export default class', () => {
    const out = stripModuleSyntax('export default class App {}')
    expect(out).toBe('class App {}')
  })

  it('drops a bare export default expression prefix', () => {
    const out = stripModuleSyntax('function App() {}\nexport default App')
    expect(out).toContain('function App() {}')
    expect(out).not.toContain('export')
  })

  it('unwraps named exports of declarations', () => {
    const out = stripModuleSyntax('export const a = 1\nexport function App() {}')
    expect(out).toContain('const a = 1')
    expect(out).toContain('function App() {}')
    expect(out).not.toContain('export')
  })

  it('removes export lists', () => {
    const out = stripModuleSyntax('function App() {}\nexport { App }')
    expect(out).toContain('function App() {}')
    expect(out).not.toContain('export')
  })
})

describe('hasEntryCall', () => {
  it('detects createRoot(...).render', () => {
    expect(hasEntryCall(`ReactDOM.createRoot(document.getElementById('root')).render(<App />)`)).toBe(true)
  })

  it('detects legacy ReactDOM.render', () => {
    expect(hasEntryCall('ReactDOM.render(<App />, root)')).toBe(true)
  })

  it('is false for plain App definitions', () => {
    expect(hasEntryCall('function App() { return null }')).toBe(false)
  })
})

describe('classifyCode', () => {
  it('classifies App definitions as jsx-app', () => {
    expect(classifyCode('function App() { return <div /> }')).toBe('jsx-app')
    expect(classifyCode('const App = () => <div />')).toBe('jsx-app')
    expect(classifyCode('export default function App() { return null }')).toBe('jsx-app')
  })

  it('classifies plain markup as html', () => {
    expect(classifyCode('<p class="text-xl">Hello</p>')).toBe('html')
    expect(classifyCode('<div class="h-full w-full rounded-lg bg-white"></div>')).toBe('html')
    expect(classifyCode('<section><style>.a{color:red}</style><h1>Hi</h1></section>')).toBe('html')
    expect(classifyCode('<div><script>console.log(1)</script></div>')).toBe('html')
  })

  it('classifies full documents as html', () => {
    expect(classifyCode('<!doctype html><html><body>Hi</body></html>')).toBe('html')
  })

  it('classifies markup with JSX signals as jsx-snippet', () => {
    expect(classifyCode('<p className="text-xl">Hello</p>')).toBe('jsx-snippet')
    expect(classifyCode('<Card title="Hi" />')).toBe('jsx-snippet')
    expect(classifyCode('<div style={{ color: "red" }}>Hi</div>')).toBe('jsx-snippet')
  })

  it('classifies non-markup code as jsx-snippet', () => {
    expect(classifyCode('Hello world')).toBe('jsx-snippet')
  })
})

describe('compileForFrame', () => {
  const fakeBabel: BabelLike = {
    transform: (code) => ({ code: `/*compiled*/\n${code}` }),
  }
  const failingBabel: BabelLike = {
    transform: () => {
      throw new Error('unknown: Unexpected token (2:14)')
    },
  }

  it('passes html through without a compiler', async () => {
    const result = await compileForFrame('<p class="text-xl">Hello</p>', null)
    expect(result).toEqual({
      ok: true,
      payload: { mode: 'html', code: '<p class="text-xl">Hello</p>', needsEntry: false },
    })
  })

  it('compiles App definitions to executable js', async () => {
    const result = await compileForFrame('function App() { return <div /> }', fakeBabel)
    if (!result.ok) throw new Error('expected ok')
    expect(result.payload.mode).toBe('js')
    expect(result.payload.needsEntry).toBe(true)
    expect(result.payload.code).toContain('/*compiled*/')
  })

  it('respects an explicit entry call', async () => {
    const source = `function App() { return <div /> }\nReactDOM.createRoot(document.getElementById('root')).render(<App />)`
    const result = await compileForFrame(source, fakeBabel)
    if (!result.ok) throw new Error('expected ok')
    expect(result.payload.needsEntry).toBe(false)
  })

  it('wraps jsx snippets in an App function', async () => {
    const calls: string[] = []
    const spyBabel: BabelLike = {
      transform: (code) => {
        calls.push(code)
        return { code }
      },
    }
    const result = await compileForFrame('<p className="text-xl">Hi</p>', spyBabel)
    if (!result.ok) throw new Error('expected ok')
    expect(calls[0]).toContain('function App() { return <>')
  })

  it('strips module syntax before compiling', async () => {
    const calls: string[] = []
    const spyBabel: BabelLike = {
      transform: (code) => {
        calls.push(code)
        return { code }
      },
    }
    await compileForFrame(`import { useState } from 'react'\nexport default function App() { return null }`, spyBabel)
    expect(calls[0]).not.toContain('import')
    expect(calls[0]).not.toContain('export')
  })

  it('tries the typescript preset for TSX support', async () => {
    const presetsUsed: unknown[] = []
    const spyBabel: BabelLike = {
      transform: (code, options) => {
        presetsUsed.push(options.presets)
        return { code }
      },
    }
    await compileForFrame('function App() { const [n] = useState<number>(0); return <div>{n}</div> }', spyBabel)
    expect(JSON.stringify(presetsUsed[0])).toContain('typescript')
  })

  it('supports an async transform (compile worker)', async () => {
    const asyncBabel: BabelLike = {
      transform: async (code) => ({ code: `/*worker*/\n${code}` }),
    }
    const result = await compileForFrame('function App() { return <div /> }', asyncBabel)
    if (!result.ok) throw new Error('expected ok')
    expect(result.payload.code).toContain('/*worker*/')
  })

  it('falls back to html when a markup snippet fails to compile', async () => {
    const result = await compileForFrame('<div style={{}}><style>.a{color:red}</style></div>', failingBabel)
    if (!result.ok) throw new Error('expected html fallback')
    expect(result.payload.mode).toBe('html')
  })

  it('reports a readable compile error for broken App code', async () => {
    const result = await compileForFrame('function App() { return <div } ', failingBabel)
    if (result.ok) throw new Error('expected error')
    expect(result.error).toContain('Unexpected token (2:14)')
    expect(result.error).not.toContain('unknown:')
  })

  it('echoes the offending source line alongside the compile error position', async () => {
    const source = 'function App() {\n  return <div }\n}'
    const result = await compileForFrame(source, failingBabel)
    if (result.ok) throw new Error('expected error')
    expect(result.error).toContain('Unexpected token (2:14)')
    expect(result.error).toContain('return <div }')
  })
})

describe('buildElementDoc', () => {
  const doc = buildElementDoc()

  it('loads only vendored same-origin runtime scripts, without Babel', () => {
    expect(doc).toContain('src="/vendor/tailwind.js"')
    expect(doc).toContain('src="/vendor/react.js"')
    expect(doc).toContain('src="/vendor/react-dom.js"')
    expect(doc).toContain('src="/vendor/html-to-image.js"')
    // JSX compiles in the parent — the 3MB compiler must not boot per frame.
    expect(doc).not.toContain('babel')
    expect(doc).not.toContain('unpkg.com')
    expect(doc).not.toContain('cdn.tailwindcss.com')
  })

  it('injects the React globals prelude', () => {
    expect(doc).toContain(REACT_GLOBALS_PRELUDE)
  })

  it('receives code via postMessage, not inline', () => {
    expect(doc).toContain("msg.type !== 'loora:code'")
    expect(doc).toContain("parent.postMessage({ type: 'loora:element-ready' }, '*')")
  })

  it('reports render results with sequence numbers for last-good rendering', () => {
    expect(doc).toContain("'loora:ok'")
    expect(doc).toContain("'loora:error'")
    expect(doc).toContain('seq')
  })

  it('reports unhandled promise rejections', () => {
    expect(doc).toContain('unhandledrejection')
  })

  it('clears timers, animation frames, and listeners between payloads', () => {
    expect(doc).toContain('__clearPayloadGlobals')
    expect(doc).toContain('clearInterval')
    expect(doc).toContain('cancelAnimationFrame')
    expect(doc).toContain('removeEventListener')
    // teardown runs the cleanup before each mount
    expect(doc.indexOf('__clearPayloadGlobals()')).toBeGreaterThan(-1)
  })

  it('keeps payload code from navigating the frame', () => {
    expect(doc).toContain("document.addEventListener('submit'")
    expect(doc).toContain("document.addEventListener('click'")
  })

  it('mounts raw HTML and re-executes inline scripts', () => {
    expect(doc).toContain('__mountHtml')
    expect(doc).toContain("querySelectorAll('script')")
  })

  it('answers capture requests', () => {
    expect(doc).toContain("'loora:capture'")
    expect(doc).toContain("'loora:capture-result'")
    expect(doc).toContain('htmlToImage.toPng')
  })

  it('bounds capture styles and returns the final browser error', () => {
    expect(CAPTURE_STYLE_PROPERTIES.length).toBeGreaterThan(100)
    expect(CAPTURE_STYLE_PROPERTIES.length).toBeLessThan(250)
    expect(new Set(CAPTURE_STYLE_PROPERTIES).size).toBe(
      CAPTURE_STYLE_PROPERTIES.length,
    )
    expect(CAPTURE_STYLE_PROPERTIES).toContain('background-image')
    expect(CAPTURE_STYLE_PROPERTIES).toContain('grid-template-columns')
    expect(CAPTURE_STYLE_PROPERTIES).toContain('mix-blend-mode')
    expect(CAPTURE_STYLE_PROPERTIES).toContain('transform')
    expect(doc).toContain('includeStyleProperties: captureStyleProperties')
    expect(doc).toContain('error: captureError || null')
    expect(doc).toContain('retry without fonts failed')
  })

  it('scales large captures before the browser decodes the SVG', () => {
    expect(doc).toContain('var maxDimension = typeof msg.maxDimension')
    expect(doc).toContain('var captureScale = Math.min')
    expect(doc).toContain("transform: 'scale(' + captureScale + ')'")
    expect(doc).toContain('options.width = scaledCaptureWidth')
    expect(doc).toContain('options.height = scaledCaptureHeight')
  })

  it('passes preloaded fonts into the capture sandbox', () => {
    expect(doc).toContain('fontEmbedCSS: msg.fontEmbedCSS')
  })

  it('tracks runtime changes and marks animated captures as volatile', () => {
    expect(doc).toContain("type: 'loora:dirty'")
    expect(doc).toContain('new MutationObserver(__markDirty)')
    expect(doc).toContain('document.getAnimations()')
    expect(doc).toContain('volatile: volatile')
  })

  it('has a transparent background so text and unstyled elements sit on the canvas', () => {
    expect(doc).toContain('background:transparent')
  })

  it('supports suspend/resume so offscreen frames stop animating', () => {
    expect(doc).toContain("'loora:suspend'")
    expect(doc).toContain("'loora:resume'")
    expect(doc).toContain('__applySuspend')
    expect(doc).toContain('__rafQueue')
  })

  it('supports inline text editing that reports before/after pairs', () => {
    expect(doc).toContain("'loora:edit-mode'")
    expect(doc).toContain("'loora:text-edit'")
    expect(doc).toContain('contenteditable')
    // The frame never rewrites code itself — the parent maps text pairs.
    expect(doc).toContain('__endEditSession')
  })

  it('reports image clicks in edit mode for the parent asset picker', () => {
    expect(doc).toContain("'loora:image-pick'")
    // The raw attribute, not the resolved .src — it must match the code text.
    expect(doc).toContain("img.getAttribute('src')")
  })

  it('reports right-clicked nodes in edit mode for the style editor', () => {
    expect(doc).toContain("'loora:style-pick'")
    // The raw class attribute — it must match the code text for replacement.
    expect(doc).toContain("t.getAttribute('class')")
  })

  it('reports drag-reorder drops with node and anchor markup', () => {
    expect(doc).toContain("'loora:node-move'")
    expect(doc).toContain('outerHTML')
    // Restored inline styles must not leave style="" behind, or the
    // outerHTML would stop matching the source.
    expect(doc).toContain('__dropEmptyStyle')
  })

  it('answers measure requests with the natural content size', () => {
    expect(doc).toContain("'loora:measure'")
    expect(doc).toContain('scrollHeight')
  })

  it('exposes the cross-element message bus', () => {
    expect(doc).toContain('window.loora')
    expect(doc).toContain("'loora:bus'")
    expect(doc).toContain("'loora:bus-deliver'")
  })

  it('captures at device pixel ratio and flags skipped fonts', () => {
    expect(doc).toContain('pixelRatio')
    expect(doc).toContain('fontsSkipped')
    expect(doc).toContain('skipFonts: !!skipFonts')
  })
})

describe('inlineAssetUrls', () => {
  it('returns code without asset urls untouched and without fetching', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = mock()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    try {
      const code = '<div class="p-4">no assets here</div>'
      expect(await inlineAssetUrls(code)).toBe(code)
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('keeps the original url when the asset cannot be fetched', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = mock().mockResolvedValue({ ok: false })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    try {
      const code = '<img src="/api/asset/broken404" /><img src="/api/asset/broken404" />'
      expect(await inlineAssetUrls(code)).toBe(code)
      // deduped: one fetch for the repeated url
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
