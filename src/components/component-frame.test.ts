import { describe, expect, it } from 'bun:test'
import {
  buildComponentDoc,
  hasEntryCall,
  stripModuleSyntax,
} from '#/components/component-frame'

describe('stripModuleSyntax', () => {
  it('strips default and named imports', () => {
    const src = `import React, { useState } from 'react'
import { memo } from 'react'
function App() { return <div /> }
`
    const out = stripModuleSyntax(src)
    expect(out).not.toMatch(/\bimport\b/)
    expect(out).toContain('function App()')
  })

  it('strips side-effect imports', () => {
    expect(stripModuleSyntax(`import './styles.css'\nconst x = 1\n`)).not.toMatch(/\bimport\b/)
  })

  it('rewrites export default function App', () => {
    const out = stripModuleSyntax('export default function App() { return null }\n')
    expect(out).toBe('function App() { return null }\n')
  })

  it('strips export default expr', () => {
    const out = stripModuleSyntax('export default App\n')
    expect(out.trim()).toBe('App')
  })

  it('strips named exports and export braces', () => {
    const src = `export const foo = 1
export function bar() {}
export { foo, bar }
`
    const out = stripModuleSyntax(src)
    expect(out).toContain('const foo = 1')
    expect(out).toContain('function bar() {}')
    expect(out).not.toMatch(/\bexport\b/)
  })

  it('leaves useState and JSX body intact', () => {
    const src = `import { useState } from 'react'
export default function App() {
  const [n, setN] = useState(0)
  return <button onClick={() => setN(n + 1)}>{n}</button>
}
`
    const out = stripModuleSyntax(src)
    expect(out).toContain('useState(0)')
    expect(out).toContain('onClick')
    expect(out).toContain('function App()')
  })
})

describe('hasEntryCall', () => {
  it('detects ReactDOM.createRoot().render', () => {
    expect(
      hasEntryCall(`ReactDOM.createRoot(document.getElementById('root')).render(<App />)`),
    ).toBe(true)
  })

  it('detects ReactDOM.render', () => {
    expect(hasEntryCall(`ReactDOM.render(<App />, document.getElementById('root'))`)).toBe(true)
  })

  it('returns false when no mount', () => {
    expect(hasEntryCall('function App() { return null }')).toBe(false)
  })
})

describe('buildComponentDoc', () => {
  const doc = buildComponentDoc()

  it('pins React 18.3.1 and Babel 7.29.0 UMD scripts', () => {
    expect(doc).toContain('react@18.3.1/umd/react.development.js')
    expect(doc).toContain('react-dom@18.3.1/umd/react-dom.development.js')
    expect(doc).toContain('@babel/standalone@7.29.0/babel.min.js')
    expect(doc).toContain('cdn.tailwindcss.com')
  })

  it('does not use import maps or ESM babel modules', () => {
    expect(doc).not.toContain('importmap')
    expect(doc).not.toContain('esm.sh')
    expect(doc).not.toContain('data-type="module"')
  })

  it('injects globalThis hook prelude', () => {
    expect(doc).toContain('Object.assign(globalThis')
    expect(doc).toContain('useState: React.useState')
  })

  it('contains no agent code — code arrives over postMessage', () => {
    expect(doc).toContain("msg.type !== 'loora:code'")
    expect(doc).toContain('Babel.transform(msg.code')
    expect(doc).toContain("parent.postMessage({ type: 'loora:component-ready' }")
    expect(doc).not.toContain('text/babel')
  })

  it('keeps the escaped newline literal in the App-return wrapper', () => {
    // A raw newline inside the generated string literal would be a SyntaxError
    // in the iframe; the template must emit the two-character \n escape.
    expect(doc).toContain('\\n;return typeof App !== "undefined" ? App : null')
  })

  it('answers capture requests', () => {
    expect(doc).toContain("msg.type === 'loora:capture'")
    expect(doc).toContain('loora:capture-result')
  })
})
