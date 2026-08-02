import { describe, expect, it } from 'vitest'
import { parseFontFamilyNames, vendorFontFaceCss } from './export-fonts'

describe('vendor export fonts', () => {
  it('parses quoted and bare font-family stacks', () => {
    expect(parseFontFamilyNames('"Helvetica Neue", Arial, sans-serif')).toEqual(
      ['Helvetica Neue', 'Arial', 'sans-serif'],
    )
    expect(parseFontFamilyNames("Playfair Display")).toEqual([
      'Playfair Display',
    ])
  })

  it('emits only matching vendor faces', () => {
    const css = vendorFontFaceCss(['Lora', '"Inter", system-ui'])
    expect(css).toContain("font-family:'Lora'")
    expect(css).toContain("font-family:'Inter'")
    expect(css).toContain('/vendor/fonts/lora-latin.woff2')
    expect(css).not.toContain('playfair')
  })

  it('prefixes faces with an absolute font origin', () => {
    const css = vendorFontFaceCss(['Archivo'], 'https://example.test/')
    expect(css).toContain(
      'url(https://example.test/vendor/fonts/archivo-latin.woff2)',
    )
  })
})
