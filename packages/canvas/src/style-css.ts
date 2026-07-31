import type {
  CanvasColor,
  CanvasDocument,
  CanvasPaint,
  CanvasStylePatch,
} from './model'

/**
 * Turning style values into CSS values.
 *
 * Split out of the exporter because motion needs the same answers: a hover that
 * changes a fill has to produce the declaration the exporter would have
 * produced, or the canvas and the download disagree about what the design is.
 */

export function escapeCssString(value: string) {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0)!
      if (character === '\\' || character === '"' || code < 32 || code === 127) {
        return `\\${code.toString(16)} `
      }
      return character
    })
    .join('')
}

const genericFontFamilies = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
  'inherit',
  'initial',
  'revert',
  'unset',
])

/**
 * A family is a list, not a single name. Quoting the whole string collapsed
 * `"Helvetica Neue", Arial, sans-serif` — what an HTML import records — into one
 * unusable family, so each entry is quoted on its own and generic keywords are
 * left bare.
 */
export function fontFamilyValue(family: string) {
  const families = family
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (/^"[^"]*"$/.test(part) || /^'[^']*'$/.test(part)) return part
      if (genericFontFamilies.has(part.toLowerCase())) return part
      return `"${part.replaceAll('"', '').replaceAll("'", '')}"`
    })
  return families.length > 0 ? families.join(', ') : JSON.stringify(family)
}

export function colorValue(_document: CanvasDocument, color: CanvasColor) {
  if (typeof color === 'string') return color
  return `var(--loora-token-${color.token.replace(/[^a-zA-Z0-9_-]/g, '-')})`
}

export function paintValue(document: CanvasDocument, paint: CanvasPaint) {
  if (paint.type === 'solid') return colorValue(document, paint.color)
  const stops = paint.stops
    .map((stop) => `${colorValue(document, stop.color)} ${stop.offset * 100}%`)
    .join(', ')
  if (paint.type === 'radial-gradient') {
    const size = paint.size?.trim() || 'farthest-corner'
    return `radial-gradient(${size} at ${paint.cx * 100}% ${paint.cy * 100}%, ${stops})`
  }
  return `linear-gradient(${paint.angle}deg, ${stops})`
}

/**
 * The declarations for a partial style — what a visual state carries. Only the
 * fields the patch actually sets are emitted, because a hover that mentions a
 * shadow should not also restate the fill it is leaving alone.
 */
export function stylePatchDeclarations(
  document: CanvasDocument,
  patch: CanvasStylePatch,
  options: { asText?: boolean } = {},
) {
  const declarations: string[] = []
  if (patch.opacity !== undefined) declarations.push(`opacity:${patch.opacity}`)
  if (patch.overflow !== undefined) declarations.push(`overflow:${patch.overflow}`)
  if (patch.fills !== undefined && patch.fills.length > 0) {
    declarations.push(
      options.asText && patch.fills[0]?.type === 'solid'
        ? `color:${colorValue(document, patch.fills[0].color)}`
        : `background:${patch.fills
            .map((paint) => paintValue(document, paint))
            .join(',')}`,
    )
  }
  if (patch.stroke !== undefined) {
    declarations.push(
      `border:${patch.stroke.width}px ${patch.stroke.style ?? 'solid'} ${colorValue(
        document,
        patch.stroke.color,
      )}`,
    )
  }
  if (patch.radius !== undefined) {
    const radii = Array.isArray(patch.radius) ? patch.radius : [patch.radius]
    declarations.push(`border-radius:${radii.map((radius) => `${radius}px`).join(' ')}`)
  }
  if (patch.shadows !== undefined) {
    declarations.push(
      patch.shadows.length > 0
        ? `box-shadow:${patch.shadows
            .map(
              (shadow) =>
                `${shadow.inset ? 'inset ' : ''}${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.spread}px ${colorValue(document, shadow.color)}`,
            )
            .join(',')}`
        : 'box-shadow:none',
    )
  }
  if (patch.blendMode !== undefined) {
    declarations.push(`mix-blend-mode:${patch.blendMode}`)
  }
  const typography = patch.typography
  if (typography) {
    if (typography.family !== undefined) {
      declarations.push(`font-family:${fontFamilyValue(typography.family)}`)
    }
    if (typography.size !== undefined) declarations.push(`font-size:${typography.size}px`)
    if (typography.weight !== undefined) declarations.push(`font-weight:${typography.weight}`)
    if (typography.lineHeight !== undefined) {
      declarations.push(`line-height:${typography.lineHeight}`)
    }
    if (typography.letterSpacing !== undefined) {
      declarations.push(`letter-spacing:${typography.letterSpacing}px`)
    }
    if (typography.align !== undefined) declarations.push(`text-align:${typography.align}`)
    if (typography.decoration !== undefined) {
      declarations.push(`text-decoration:${typography.decoration}`)
    }
    if (typography.transform !== undefined) {
      declarations.push(`text-transform:${typography.transform}`)
    }
  }
  return declarations
}
