import { describe, expect, it } from 'vitest'
import {
  HTML_IMPORT_SANDBOX_BASE_CSS,
  MAX_HTML_IMPORT_SOURCE_BYTES,
  buildHtmlImportDocument,
} from './canvas-html-import'

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
    expect(output).toContain('font-src https: data:')
    expect(output).toContain('img-src https: data: blob:')
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

  it('gives the Paper Snapshot transport wrapper a shrink-to-fit layout', () => {
    const output = buildHtmlImportDocument(
      '<x-paper-html><a style="display:flex;width:auto;height:58px;padding:12px 24px">Deploy →</a></x-paper-html>',
    )
    const parsed = new DOMParser().parseFromString(output, 'text/html')
    const sandboxStyle = parsed.querySelector(
      'style[data-loora-html-import="true"]',
    )

    expect(sandboxStyle?.textContent).toContain(
      'x-paper-html{display:inline-block}',
    )
  })

  it('embeds Tailwind Preflight so Paper pastes do not invent strokes', () => {
    const output = buildHtmlImportDocument(
      '<div style="border-style:solid;border-color:rgb(42,42,42)">Card</div>',
    )
    const parsed = new DOMParser().parseFromString(output, 'text/html')
    const sandboxStyle = parsed.querySelector(
      'style[data-loora-html-import="true"]',
    )

    expect(sandboxStyle?.textContent).toContain('border: 0 solid')
    expect(HTML_IMPORT_SANDBOX_BASE_CSS).toContain('border: 0 solid')
    expect(HTML_IMPORT_SANDBOX_BASE_CSS).toContain('list-style: none')
  })

  it('accepts Paper-sized HTML pastes under the source budget', () => {
    // A couple of embedded images used to blow past the old 1 MB cap.
    const chunk = 'a'.repeat(1_500_000)
    const html = `<x-paper-html><div data-chunk="${chunk}">Card</div></x-paper-html>`
    expect(html.length).toBeGreaterThan(1_000_000)
    expect(html.length).toBeLessThan(MAX_HTML_IMPORT_SOURCE_BYTES)
    expect(() => buildHtmlImportDocument(html)).not.toThrow()
  })

  it('rejects HTML pastes above the source budget', () => {
    const html = `<div>${'a'.repeat(MAX_HTML_IMPORT_SOURCE_BYTES + 1)}</div>`
    expect(() => buildHtmlImportDocument(html)).toThrow(
      'HTML import is larger than 8 MB',
    )
  })
})
