import { describe, expect, it } from 'bun:test'
import {
  buildElementDoc,
  classifyCode,
  hasEntryCall,
  REACT_GLOBALS_PRELUDE,
  stripModuleSyntax,
} from './element-frame'

describe('stripModuleSyntax', () => {
  it('removes named imports', () => {
    const out = stripModuleSyntax(`import { useState } from 'react'\nfunction App() {}`)
    expect(out).not.toContain('import')
    expect(out).toContain('function App()')
  })

  it('removes default and namespace imports', () => {
    const out = stripModuleSyntax(
      `import React from 'react'\nimport * as icons from 'lucide-react'\nconst x = 1`,
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

describe('buildElementDoc', () => {
  const doc = buildElementDoc()

  it('loads only vendored same-origin runtime scripts', () => {
    expect(doc).toContain('src="/vendor/tailwind.js"')
    expect(doc).toContain('src="/vendor/react.js"')
    expect(doc).toContain('src="/vendor/react-dom.js"')
    expect(doc).toContain('src="/vendor/babel.js"')
    expect(doc).toContain('src="/vendor/html-to-image.js"')
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
    // compile happens before the previous render is torn down
    expect(doc.indexOf('Babel.transform')).toBeLessThan(doc.indexOf('__teardown()', doc.indexOf('Babel.transform')))
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

  it('has a transparent background so text and unstyled elements sit on the canvas', () => {
    expect(doc).toContain('background:transparent')
  })
})
