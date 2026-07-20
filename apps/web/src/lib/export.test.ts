import { describe, expect, it } from 'bun:test'
import { buildDesignJson, buildSafeHtml, safeExportName } from './export'
import type { CanvasElement } from './canvas'

const elements: CanvasElement[] = [
  {
    id: 'section-1',
    name: 'Hero',
    x: 10,
    y: 20,
    w: 320,
    h: 200,
    code: '<h1 onclick="alert(1)">Hello</h1><script>alert(1)</script>',
  },
  {
    id: 'widget-1',
    name: 'Counter',
    x: 350,
    y: 20,
    w: 200,
    h: 100,
    code: 'function App() { return <button>Count</button> }',
  },
]

describe('safe design exports', () => {
  it('keeps complete element source in the JSON export', () => {
    const exported = JSON.parse(buildDesignJson('design-1', 'Landing', elements))
    expect(exported.schema).toBe('loora.design')
    expect(exported.version).toBe(2)
    expect(exported.design.elements[0].code).toContain('<h1')
    expect(exported.design.elements[1].code).toContain('function App()')
  })

  it('builds a sandboxed static HTML document without executable source', () => {
    const exported = buildSafeHtml('Landing', elements)
    expect(exported).toContain('Content-Security-Policy')
    // HTML elements render as sandboxed, sanitized iframes
    expect(exported).toContain('sandbox=""')
    expect(exported).not.toContain('onclick=')
    expect(exported).not.toContain('alert(1)')
    // JSX elements need a runtime; the static export shows a placeholder
    expect(exported).toContain('code included in JSON export')
    expect(exported).not.toContain('function App()')
  })

  it('creates filesystem-safe filenames', () => {
    expect(safeExportName(' My / Great: Design ', 'png')).toBe('My-Great-Design.png')
  })
})
