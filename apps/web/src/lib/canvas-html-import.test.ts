import { describe, expect, it } from 'bun:test'
import { buildHtmlImportDocument } from './canvas-html-import'

describe('HTML import sandbox', () => {
  it('removes executable markup and blocks outbound resources', () => {
    const output = buildHtmlImportDocument(
      '<div onclick="alert(1)">Hello<script>alert(2)</script><iframe src="https://example.com"></iframe></div>',
      '.hero { color: red }',
    )

    expect(output).not.toContain('onclick=')
    expect(output).not.toContain('<script')
    expect(output).not.toContain('<iframe')
    expect(output).toContain("default-src 'none'")
    expect(output).toContain("connect-src 'none'")
    expect(output).toContain('.hero { color: red }')
  })

  it('does not let CSS close the sandbox style element', () => {
    const output = buildHtmlImportDocument(
      '<main>Hello</main>',
      '</style><meta http-equiv="refresh" content="0;url=https://example.com"><script>alert(1)</script>',
    )

    expect(output).not.toContain('</style><meta')
    expect(output).not.toContain('</style><script')
    expect(output).toContain('<\\/style>')
  })
})
