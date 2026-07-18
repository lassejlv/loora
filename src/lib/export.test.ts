import { describe, expect, it } from 'bun:test'
import { buildDesignJson, buildSafeHtml, safeExportName } from './export'
import type { Shape } from './canvas'

const shapes: Shape[] = [
  {
    id: 'frame-1',
    type: 'frame',
    x: 10,
    y: 20,
    w: 320,
    h: 200,
    fill: '#ffffff',
    html: '<h1 onclick="alert(1)">Hello</h1><script>alert(1)</script>',
  },
  {
    id: 'component-1',
    type: 'component',
    x: 350,
    y: 20,
    w: 200,
    h: 100,
    fill: '#ffffff',
    text: 'Counter',
    code: 'function App() { return <button>Count</button> }',
  },
]

describe('safe design exports', () => {
  it('keeps complete source in inert JSON while sanitizing frame HTML', () => {
    const exported = JSON.parse(buildDesignJson('design-1', 'Landing', shapes))
    expect(exported.schema).toBe('loora.design')
    expect(exported.design.shapes[0].html).toBe('<h1>Hello</h1>')
    expect(exported.design.shapes[1].code).toContain('function App()')
  })

  it('builds a sandboxed static HTML document without executable source', () => {
    const exported = buildSafeHtml('Landing', shapes)
    expect(exported).toContain('Content-Security-Policy')
    expect(exported).toContain('sandbox=""')
    expect(exported).not.toContain('<script>')
    expect(exported).not.toContain('onclick=')
    expect(exported).not.toContain('function App()')
  })

  it('creates filesystem-safe filenames', () => {
    expect(safeExportName(' My / Great: Design ', 'png')).toBe('My-Great-Design.png')
  })
})
