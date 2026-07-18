import { describe, expect, it } from 'vitest'
import {
  buildComponentDoc,
  escapeForScript,
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

describe('escapeForScript', () => {
  it('escapes closing script tags', () => {
    expect(escapeForScript('const s = "</script>"')).toBe('const s = "<\\/script>"')
  })

  it('is case-insensitive', () => {
    expect(escapeForScript('</SCRIPT>')).toBe('<\\/script>')
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
  const counter = `import { useState } from 'react'
export default function App() {
  const [n, setN] = useState(0)
  return <button onClick={() => setN(n + 1)}>{n}</button>
}
`

  it('pins React 18.3.1 and Babel 7.29.0 UMD scripts', () => {
    const doc = buildComponentDoc(counter)
    expect(doc).toContain('react@18.3.1/umd/react.development.js')
    expect(doc).toContain('react-dom@18.3.1/umd/react-dom.development.js')
    expect(doc).toContain('@babel/standalone@7.29.0/babel.min.js')
    expect(doc).toContain('cdn.tailwindcss.com')
  })

  it('does not use import maps or ESM babel modules', () => {
    const doc = buildComponentDoc(counter)
    expect(doc).not.toContain('importmap')
    expect(doc).not.toContain('esm.sh')
    expect(doc).not.toContain('data-type="module"')
  })

  it('injects globalThis hook prelude', () => {
    const doc = buildComponentDoc(counter)
    expect(doc).toContain('Object.assign(globalThis')
    expect(doc).toContain('useState: React.useState')
  })

  it('includes stripped agent code without imports', () => {
    const doc = buildComponentDoc(counter)
    expect(doc).toContain('function App()')
    expect(doc).toContain('useState(0)')
    expect(doc).toContain('onClick')
    expect(doc).not.toMatch(/import \{ useState \} from ['"]react['"]/)
  })

  it('auto-appends mount when agent did not', () => {
    const doc = buildComponentDoc(counter)
    expect(doc).toContain('ReactDOM.createRoot')
  })

  it('does not double-mount when agent already mounts', () => {
    const withEntry = `function App() { return <div /> }
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App))
`
    const doc = buildComponentDoc(withEntry)
    const mounts = doc.match(/ReactDOM\.createRoot/g) ?? []
    expect(mounts).toHaveLength(1)
  })

  it('escapes script closers in agent source', () => {
    const doc = buildComponentDoc(`function App() { return <div>{"</script>"}</div> }`)
    expect(doc).toContain('<\\/script>')
    expect(doc).not.toMatch(/<\/script>\{\}/)
  })
})
