import { describe, expect, it } from 'bun:test'
import { classifyCode } from '#/components/element-frame'
import { imageTemplate, pageTemplate, TEMPLATE_DEFAULTS } from './element-templates'

describe('element templates', () => {
  it('produce html-classified starter code', () => {
    for (const template of Object.values(TEMPLATE_DEFAULTS)) {
      expect(classifyCode(template.code)).toBe('html')
      expect(template.w).toBeGreaterThan(0)
      expect(template.h).toBeGreaterThan(0)
      expect(template.name.length).toBeGreaterThan(0)
    }
  })

  it('imageTemplate renders the asset url', () => {
    const code = imageTemplate('/api/asset/abc', 'Team photo')
    expect(code).toContain('src="/api/asset/abc"')
    expect(code).toContain('alt="Team photo"')
    expect(classifyCode(code)).toBe('html')
  })

  it('imageTemplate escapes quotes in alt text', () => {
    expect(imageTemplate('/api/asset/abc', 'a"b')).toContain('alt="a&quot;b"')
  })

  it('imageTemplate without src renders a placeholder', () => {
    const code = imageTemplate()
    expect(code).not.toContain('<img')
    expect(classifyCode(code)).toBe('html')
  })

  it('pageTemplate produces a full-width html page starter', () => {
    const first = pageTemplate(1)
    expect(first.name).toBe('Page')
    expect(first.w).toBe(1440)
    expect(classifyCode(first.code)).toBe('html')
    expect(pageTemplate(3).name).toBe('Page 3')
  })
})
