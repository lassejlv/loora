// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { sanitizeHtml, toXhtml } from './sanitize'

describe('sanitizeHtml', () => {
  it('strips script tags', () => {
    expect(sanitizeHtml('<div>hi</div><script>alert(1)</script>')).toBe('<div>hi</div>')
  })

  it('strips iframes, objects, forms', () => {
    expect(sanitizeHtml('<iframe src="x"></iframe><object></object><form><input/></form>')).toBe(
      '',
    )
  })

  it('strips event handler attributes', () => {
    expect(sanitizeHtml('<button onclick="alert(1)">go</button>')).toBe('<button>go</button>')
  })

  it('strips javascript: urls', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>')
  })

  it('strips scheme obfuscation and non-image data urls', () => {
    expect(sanitizeHtml('<a href="java\nscript:alert(1)">x</a>')).toBe('<a>x</a>')
    expect(sanitizeHtml('<a href=" JaVaScRiPt:alert(1)">x</a>')).toBe('<a>x</a>')
    expect(sanitizeHtml('<a href="data:text/html,<script>1</script>">x</a>')).toBe('<a>x</a>')
    expect(sanitizeHtml('<a href="data:application/javascript,alert(1)">x</a>')).toBe('<a>x</a>')
    expect(sanitizeHtml('<a href="vbscript:msgbox(1)">x</a>')).toBe('<a>x</a>')
    expect(sanitizeHtml('<a href="blob:https://x/1">x</a>')).toBe('<a>x</a>')
  })

  it('keeps http, relative, fragment, and data:image urls', () => {
    const html =
      '<a href="https://example.com">a</a><a href="/api/asset/1">b</a><a href="#top">c</a><img src="data:image/png;base64,AAA=">'
    expect(sanitizeHtml(html)).toBe(html)
  })

  it('keeps styles, classes, and safe urls', () => {
    const html =
      '<style>.a{color:red}</style><div class="flex p-4" style="gap:8px"><img src="/api/asset/1"></div>'
    expect(sanitizeHtml(html)).toBe(html)
  })
})

describe('toXhtml', () => {
  it('closes void elements for XML embedding', () => {
    expect(toXhtml('<img src="/x"><br>')).toContain('<img src="/x" />')
  })
})
