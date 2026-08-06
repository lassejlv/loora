import { describe, expect, it } from 'vitest'
import {
  type LayoutParent,
  colorValue,
  escapeCssString,
  fontFamilyValue,
  layoutDeclarations,
  lengthValue,
  paintValue,
  stylePatchDeclarations,
} from './style-css'
import {
  createCanvasDocument,
  defaultLayout,
  type CanvasColor,
  type CanvasLayout,
  type CanvasPaint,
  type CanvasStylePatch,
} from './model'

const document = createCanvasDocument('Test', 'doc')

describe('escapeCssString', () => {
  it('passes through safe characters', () => {
    expect(escapeCssString('hello world')).toBe('hello world')
  })

  it('escapes backslash and double quote', () => {
    expect(escapeCssString('a\\b')).toBe('a\\5c b')
    expect(escapeCssString('a"b')).toBe('a\\22 b')
  })

  it('escapes control characters', () => {
    expect(escapeCssString('a\tb')).toBe('a\\9 b')
    expect(escapeCssString('a\nb')).toBe('a\\a b')
    expect(escapeCssString('a\rb')).toBe('a\\d b')
  })

  it('escapes DEL (0x7f)', () => {
    expect(escapeCssString('a\x7fb')).toBe('a\\7f b')
  })

  it('handles astral characters via codePointAt', () => {
    expect(escapeCssString('🎉')).toBe('🎉')
  })
})

describe('fontFamilyValue', () => {
  it('quotes a single family name', () => {
    expect(fontFamilyValue('Helvetica Neue')).toBe('"Helvetica Neue"')
  })

  it('leaves generic keywords bare', () => {
    expect(fontFamilyValue('sans-serif')).toBe('sans-serif')
    expect(fontFamilyValue('serif')).toBe('serif')
    expect(fontFamilyValue('monospace')).toBe('monospace')
    expect(fontFamilyValue('system-ui')).toBe('system-ui')
  })

  it('splits and quotes a comma-separated stack', () => {
    expect(fontFamilyValue('Helvetica Neue, Arial, sans-serif'))
      .toBe('"Helvetica Neue", "Arial", sans-serif')
  })

  it('preserves already-quoted families', () => {
    expect(fontFamilyValue('"Helvetica Neue", sans-serif'))
      .toBe('"Helvetica Neue", sans-serif')
  })

  it('handles single-quoted families', () => {
    expect(fontFamilyValue("'Helvetica Neue', sans-serif"))
      .toBe("'Helvetica Neue', sans-serif")
  })

  it('falls back to JSON.stringify for empty input', () => {
    expect(fontFamilyValue('')).toBe(JSON.stringify(''))
  })

  it('strips embedded quotes from a family name', () => {
    expect(fontFamilyValue('Hel"vetica')).toBe('"Helvetica"')
  })
})

describe('colorValue', () => {
  it('passes through string colors', () => {
    expect(colorValue(document, '#ff0000' as CanvasColor)).toBe('#ff0000')
  })

  it('converts token references to CSS variables', () => {
    expect(colorValue(document, { token: 'color.primary' } as CanvasColor))
      .toBe('var(--loora-token-color-primary)')
  })

  it('sanitizes token names', () => {
    expect(colorValue(document, { token: 'color/primary' } as CanvasColor))
      .toBe('var(--loora-token-color-primary)')
    expect(colorValue(document, { token: 'color.primary!' } as CanvasColor))
      .toBe('var(--loora-token-color-primary-)')
  })
})

describe('paintValue', () => {
  it('resolves solid paint to a color', () => {
    const paint: CanvasPaint = { type: 'solid', color: '#ff0000' }
    expect(paintValue(document, paint)).toBe('#ff0000')
  })

  it('generates a linear gradient', () => {
    const paint: CanvasPaint = {
      type: 'linear-gradient',
      angle: 90,
      stops: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: '#0000ff' },
      ],
    }
    expect(paintValue(document, paint)).toBe('linear-gradient(90deg, #ff0000 0%, #0000ff 100%)')
  })

  it('generates a radial gradient with default size', () => {
    const paint: CanvasPaint = {
      type: 'radial-gradient',
      cx: 0.5,
      cy: 0.5,
      stops: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: '#0000ff' },
      ],
    }
    expect(paintValue(document, paint))
      .toBe('radial-gradient(farthest-corner at 50% 50%, #ff0000 0%, #0000ff 100%)')
  })

  it('generates a radial gradient with explicit size', () => {
    const paint: CanvasPaint = {
      type: 'radial-gradient',
      cx: 0.5,
      cy: 0.5,
      size: 'closest-side',
      stops: [
        { offset: 0, color: '#ff0000' },
      ],
    }
    expect(paintValue(document, paint))
      .toBe('radial-gradient(closest-side at 50% 50%, #ff0000 0%)')
  })

  it('resolves token colors in gradient stops', () => {
    const paint: CanvasPaint = {
      type: 'linear-gradient',
      angle: 0,
      stops: [
        { offset: 0, color: { token: 'color.start' } },
        { offset: 1, color: { token: 'color.end' } },
      ],
    }
    expect(paintValue(document, paint))
      .toBe('linear-gradient(0deg, var(--loora-token-color-start) 0%, var(--loora-token-color-end) 100%)')
  })
})

describe('lengthValue', () => {
  it('converts px', () => {
    expect(lengthValue({ unit: 'px', value: 100 }, 'width')).toBe('100px')
  })

  it('converts percent', () => {
    expect(lengthValue({ unit: 'percent', value: 50 }, 'width')).toBe('50%')
  })

  it('converts fill', () => {
    expect(lengthValue({ unit: 'fill' }, 'width')).toBe('100%')
  })

  it('converts hug for width', () => {
    expect(lengthValue({ unit: 'hug' }, 'width')).toBe('fit-content')
  })

  it('converts hug for height', () => {
    expect(lengthValue({ unit: 'hug' }, 'height')).toBe('auto')
  })
})

describe('layoutDeclarations', () => {
  const child = (patch: Partial<CanvasLayout> = {}) =>
    defaultLayout(200, 100, { position: 'flow', ...patch })
  const row: LayoutParent = { mode: 'flex', direction: 'row' }
  const column: LayoutParent = { mode: 'flex', direction: 'column' }

  it('sizes against the containing block when there is no parent', () => {
    const declarations = layoutDeclarations(child({ width: { unit: 'fill' } }))
    expect(declarations).toContain('width:100%')
    expect(declarations.some((item) => item.startsWith('flex-'))).toBe(false)
  })

  it('makes fill a share of the main axis rather than a full width', () => {
    const declarations = layoutDeclarations(child({ width: { unit: 'fill' } }), {
      parent: row,
    })
    expect(declarations).toContain('flex-grow:1')
    expect(declarations).toContain('flex-basis:0%')
    expect(declarations).toContain('min-width:0px')
    expect(declarations.some((item) => item.startsWith('width:'))).toBe(false)
  })

  it('keeps a fixed sibling from shrinking beside a filling one', () => {
    const declarations = layoutDeclarations(
      child({ width: { unit: 'px', value: 200 } }),
      { parent: row },
    )
    expect(declarations).toContain('width:200px')
    expect(declarations).toContain('flex-shrink:0')
  })

  it('honours an explicit minimum over the fill default', () => {
    const declarations = layoutDeclarations(
      child({ width: { unit: 'fill' }, minWidth: 120 }),
      { parent: row },
    )
    expect(declarations).toContain('min-width:120px')
    expect(declarations).not.toContain('min-width:0px')
  })

  it('stretches a filling cross axis instead of measuring the parent', () => {
    const declarations = layoutDeclarations(child({ height: { unit: 'fill' } }), {
      parent: row,
    })
    expect(declarations).toContain('align-self:stretch')
    expect(declarations.some((item) => item.startsWith('height:'))).toBe(false)
  })

  it('reads the main axis from the parent direction', () => {
    const declarations = layoutDeclarations(child({ height: { unit: 'fill' } }), {
      parent: column,
    })
    expect(declarations).toContain('flex-grow:1')
    expect(declarations).toContain('min-height:0px')
  })

  it('gives a hug a definite size so stretch cannot claim it', () => {
    const declarations = layoutDeclarations(child({ height: { unit: 'hug' } }), {
      parent: row,
    })
    expect(declarations).toContain('height:fit-content')
  })

  it('stretches a filling grid child along both axes', () => {
    const declarations = layoutDeclarations(
      child({ width: { unit: 'fill' }, height: { unit: 'fill' } }),
      { parent: { mode: 'grid' } },
    )
    expect(declarations).toContain('justify-self:stretch')
    expect(declarations).toContain('align-self:stretch')
  })

  it('sizes an out-of-flow child against its containing block', () => {
    const declarations = layoutDeclarations(
      defaultLayout(0, 0, { position: 'absolute', width: { unit: 'fill' } }),
      { parent: row },
    )
    expect(declarations).toContain('width:100%')
    expect(declarations.some((item) => item.startsWith('flex-'))).toBe(false)
  })

  it('aligns grid children inside their track, not the tracks in the row', () => {
    const declarations = layoutDeclarations(
      defaultLayout(0, 0, { mode: 'grid', columns: 3, justify: 'center' }),
    )
    expect(declarations).toContain('justify-items:center')
    expect(declarations).not.toContain('justify-content:center')
  })

  it('keeps justify-content for the values that space tracks apart', () => {
    const declarations = layoutDeclarations(
      defaultLayout(0, 0, { mode: 'grid', justify: 'space-between' }),
    )
    expect(declarations).toContain('justify-content:space-between')
  })

  it('spells the ends of the flex axes the way flexbox does', () => {
    const declarations = layoutDeclarations(
      defaultLayout(0, 0, { mode: 'flex', align: 'start', justify: 'end' }),
    )
    expect(declarations).toContain('align-items:flex-start')
    expect(declarations).toContain('justify-content:flex-end')
  })

  it('lets a filling child take a weighted share of the row', () => {
    const declarations = layoutDeclarations(
      child({ width: { unit: 'fill' }, grow: 2 }),
      { parent: row },
    )
    expect(declarations).toContain('flex-grow:2')
    expect(declarations).toContain('flex-shrink:1')
    expect(declarations).toContain('flex-basis:0%')
  })

  it('lets a fixed child keep shrinking when the row overflows', () => {
    const declarations = layoutDeclarations(
      child({ width: { unit: 'px', value: 200 }, shrink: 1 }),
      { parent: row },
    )
    expect(declarations).toContain('width:200px')
    expect(declarations).toContain('flex-shrink:1')
  })

  it('lets a child opt out of the alignment its parent hands out', () => {
    const declarations = layoutDeclarations(
      child({ alignSelf: 'end' }),
      { parent: row },
    )
    expect(declarations).toContain('align-self:flex-end')
  })

  it('does not align a child that has no parent to disagree with', () => {
    const declarations = layoutDeclarations(child({ alignSelf: 'end' }))
    expect(declarations.some((item) => item.startsWith('align-self:'))).toBe(false)
  })
})

describe('stylePatchDeclarations', () => {
  it('emits opacity', () => {
    const patch: CanvasStylePatch = { opacity: 0.5 }
    expect(stylePatchDeclarations(document, patch)).toEqual(['opacity:0.5'])
  })

  it('emits overflow', () => {
    const patch: CanvasStylePatch = { overflow: 'hidden' }
    expect(stylePatchDeclarations(document, patch)).toEqual(['overflow:hidden'])
  })

  it('emits background for solid fills', () => {
    const patch: CanvasStylePatch = {
      fills: [{ type: 'solid', color: '#ff0000' }],
    }
    expect(stylePatchDeclarations(document, patch)).toEqual(['background:#ff0000'])
  })

  it('emits color instead of background for asText solid fills', () => {
    const patch: CanvasStylePatch = {
      fills: [{ type: 'solid', color: '#ff0000' }],
    }
    expect(stylePatchDeclarations(document, patch, { asText: true }))
      .toEqual(['color:#ff0000'])
  })

  it('emits border for stroke', () => {
    const patch: CanvasStylePatch = {
      stroke: { width: 1, color: '#ff0000', style: 'dashed' },
    }
    expect(stylePatchDeclarations(document, patch)).toEqual(['border:1px dashed #ff0000'])
  })

  it('emits border with solid default style', () => {
    const patch: CanvasStylePatch = {
      stroke: { width: 2, color: '#000000' },
    }
    expect(stylePatchDeclarations(document, patch)).toEqual(['border:2px solid #000000'])
  })

  it('emits border-radius', () => {
    const patch: CanvasStylePatch = { radius: 8 }
    expect(stylePatchDeclarations(document, patch)).toEqual(['border-radius:8px'])
  })

  it('emits border-radius with array values', () => {
    const patch: CanvasStylePatch = { radius: [4, 8, 12, 16] }
    expect(stylePatchDeclarations(document, patch)).toEqual(['border-radius:4px 8px 12px 16px'])
  })

  it('emits box-shadow', () => {
    const patch: CanvasStylePatch = {
      shadows: [
        { x: 0, y: 4, blur: 8, spread: 0, color: '#000000' },
      ],
    }
    expect(stylePatchDeclarations(document, patch))
      .toEqual(['box-shadow:0px 4px 8px 0px #000000'])
  })

  it('emits inset box-shadow', () => {
    const patch: CanvasStylePatch = {
      shadows: [
        { x: 0, y: 0, blur: 4, spread: 0, color: '#ff0000', inset: true },
      ],
    }
    expect(stylePatchDeclarations(document, patch))
      .toEqual(['box-shadow:inset 0px 0px 4px 0px #ff0000'])
  })

  it('emits box-shadow none for empty shadows', () => {
    const patch: CanvasStylePatch = { shadows: [] }
    expect(stylePatchDeclarations(document, patch)).toEqual(['box-shadow:none'])
  })

  it('emits mix-blend-mode', () => {
    const patch: CanvasStylePatch = { blendMode: 'multiply' }
    expect(stylePatchDeclarations(document, patch)).toEqual(['mix-blend-mode:multiply'])
  })

  it('emits typography declarations', () => {
    const patch: CanvasStylePatch = {
      typography: {
        family: 'Inter',
        size: 16,
        weight: 400,
        lineHeight: 1.5,
        letterSpacing: 0.5,
        align: 'center',
        decoration: 'underline',
        transform: 'uppercase',
      },
    }
    expect(stylePatchDeclarations(document, patch)).toEqual([
      'font-family:"Inter"',
      'font-size:16px',
      'font-weight:400',
      'line-height:1.5',
      'letter-spacing:0.5px',
      'text-align:center',
      'text-decoration:underline',
      'text-transform:uppercase',
    ])
  })

  it('emits nothing for an empty patch', () => {
    expect(stylePatchDeclarations(document, {})).toEqual([])
  })
})