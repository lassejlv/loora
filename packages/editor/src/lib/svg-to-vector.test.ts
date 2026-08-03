import { describe, expect, it } from 'vitest'
import { looksLikeSvg, svgStringToVectorDescriptor } from './svg-to-vector'
import type { VectorDescriptor } from './svg-to-vector'
import { getHugeicons, getLucide } from './icon-libraries'

describe('svgStringToVectorDescriptor', () => {
  it('converts paths and inherits stroke from the root', () => {
    const descriptor = svgStringToVectorDescriptor(
      '<svg viewBox="0 0 24 24" stroke="currentColor" fill="none"><path d="M4 4h16"/></svg>',
    )
    expect(descriptor).not.toBeNull()
    expect(descriptor?.viewBox).toBe('0 0 24 24')
    expect(descriptor?.paths).toHaveLength(1)
    expect(descriptor?.paths[0]?.d).toBe('M4 4h16')
    expect(descriptor?.paths[0]?.stroke).toBeDefined()
  })

  it('converts shape primitives to path data', () => {
    const descriptor = svgStringToVectorDescriptor(
      '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#f00"/><rect x="2" y="2" width="8" height="8"/><line x1="0" y1="0" x2="4" y2="4" stroke="#000"/></svg>',
    )
    expect(descriptor?.paths).toHaveLength(3)
    expect(descriptor?.paths[0]?.fill).toBe('#f00')
    expect(descriptor?.paths[0]?.d).toMatch(/^M 2 12 a 10 10/)
  })

  it('derives viewBox from width/height when missing', () => {
    const descriptor = svgStringToVectorDescriptor(
      '<svg width="16" height="16"><path d="M0 0h16" stroke="#000"/></svg>',
    )
    expect(descriptor?.viewBox).toBe('0 0 16 16')
  })

  it('returns null for non-SVG input and drawable-free documents', () => {
    expect(svgStringToVectorDescriptor('<div>hi</div>')).toBeNull()
    expect(svgStringToVectorDescriptor('not markup')).toBeNull()
    expect(svgStringToVectorDescriptor('<svg viewBox="0 0 24 24"></svg>')).toBeNull()
  })

  it('rejects unsafe color values', () => {
    const descriptor = svgStringToVectorDescriptor(
      '<svg viewBox="0 0 24 24"><path d="M0 0h4" fill="url(#evil)" stroke="#123456"/></svg>',
    )
    expect(descriptor?.paths[0]?.fill).toBeUndefined()
    expect(descriptor?.paths[0]?.stroke).toBe('#123456')
  })
})

describe('looksLikeSvg', () => {
  it('accepts svg markup and rejects plain text', () => {
    expect(looksLikeSvg('<svg viewBox="0 0 24 24"></svg>')).toBe(true)
    expect(looksLikeSvg('  <?xml version="1.0"?><svg></svg>')).toBe(true)
    expect(looksLikeSvg('hello world')).toBe(false)
    expect(looksLikeSvg('')).toBe(false)
  })
})

describe('icon libraries', () => {
  it('exposes lucide entries whose vectors are visible', () => {
    const icons = getLucide()
    expect(icons.length).toBeGreaterThan(1000)
    const sample = icons.slice(0, 50)
    for (const icon of sample) {
      const vector = icon.toVector() as VectorDescriptor
      expect(vector.paths.length).toBeGreaterThan(0)
      for (const path of vector.paths) {
        expect(path.d.length).toBeGreaterThan(0)
        // Every path must be drawable — a fill or a stroke, never neither.
        expect(path.fill !== undefined || path.stroke !== undefined).toBe(true)
      }
    }
  })

  it('converts lucide shape tuples (circle, line) into path data', () => {
    const circleIcon = getLucide().find((icon) => icon.name === 'Circle')
    expect(circleIcon).toBeDefined()
    const vector = circleIcon!.toVector() as VectorDescriptor
    expect(vector.paths.length).toBeGreaterThan(0)
    expect(vector.paths[0]?.d).toMatch(/a \d/)
  })

  it('exposes hugeicons entries whose vectors are visible', () => {
    const icons = getHugeicons()
    expect(icons.length).toBeGreaterThan(1000)
    const sample = icons.slice(0, 50)
    for (const icon of sample) {
      const vector = icon.toVector() as VectorDescriptor
      expect(vector.paths.length).toBeGreaterThan(0)
      for (const path of vector.paths) {
        expect(path.fill !== undefined || path.stroke !== undefined).toBe(true)
      }
    }
  })
})
