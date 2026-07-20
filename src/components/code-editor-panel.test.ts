import { describe, expect, it } from 'bun:test'
import { codeEditorLanguage } from './code-editor-panel'

describe('codeEditorLanguage', () => {
  it('uses HTML mode for markup with embedded styles and scripts', () => {
    expect(codeEditorLanguage('<main><style>body { margin: 0 }</style><script>start()</script></main>')).toBe(
      'html',
    )
  })

  it('uses TypeScript mode for JSX and TSX apps', () => {
    expect(codeEditorLanguage('function App() { return <main className="p-4" /> }')).toBe(
      'typescript',
    )
    expect(codeEditorLanguage('function App() { const value: number = 1; return <p>{value}</p> }')).toBe(
      'typescript',
    )
  })
})
