import type {
  CanvasColor,
  CanvasDocument,
  CanvasLayout,
  CanvasLength,
  CanvasPaint,
  CanvasStylePatch,
  LayoutMode,
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
 * A length with nothing around it: what the node asks for when its parent has
 * no opinion. `fill` and `hug` only mean something next to a parent, so a node
 * inside a flex or grid container goes through `layoutDeclarations` instead.
 */
export function lengthValue(length: CanvasLength, axis: 'width' | 'height') {
  switch (length.unit) {
    case 'px':
      return `${length.value}px`
    case 'percent':
      return `${length.value}%`
    case 'fill':
      return '100%'
    case 'hug':
      return axis === 'width' ? 'fit-content' : 'auto'
  }
}

/**
 * What a node needs to know about the parent laying it out. Only the two fields
 * that change a child's own sizing, so the renderer can pass scalars and keep
 * its per-node memoization.
 */
export interface LayoutParent {
  mode: LayoutMode
  direction?: 'row' | 'column'
}

const mainAxisFor = { row: 'width', column: 'height' } as const

/** Flexbox spells the ends of its axes differently from grid. */
function flexAlignment(value: string) {
  return value === 'start' || value === 'end' ? `flex-${value}` : value
}

/**
 * How one axis of a node is sized.
 *
 * `fill` and `hug` are relative words, so the same length has to become a
 * different declaration depending on where the node lands. Inside a flex
 * container, `fill` on the main axis is a share of the free space — writing it
 * as `100%` made a fixed sibling shrink alongside it, because flex distributes
 * the overflow in proportion to each item's basis. On the cross axis it is
 * `stretch`, which respects the parent's padding where `100%` does not.
 */
function axisDeclarations(
  layout: CanvasLayout,
  axis: 'width' | 'height',
  parent: LayoutParent | undefined,
): string[] {
  const length = axis === 'width' ? layout.width : layout.height
  if (parent?.mode !== 'flex' && parent?.mode !== 'grid') {
    return [`${axis}:${lengthValue(length, axis)}`]
  }
  const isMain =
    parent.mode === 'flex' && mainAxisFor[parent.direction ?? 'row'] === axis
  if (length.unit === 'hug') {
    // A definite size is what stops `align-items: stretch` from applying, so a
    // hug reads as content-sized without having to override the parent's
    // alignment.
    return [`${axis}:fit-content`]
  }
  if (length.unit === 'fill') {
    if (isMain) {
      // Longhand, because `grow` and `shrink` override the defaults a `flex`
      // shorthand would bake in, and a later `flex` would override them back.
      return [
        `flex-grow:${layout.grow ?? 1}`,
        `flex-shrink:${layout.shrink ?? 1}`,
        'flex-basis:0%',
      ]
    }
    const property =
      parent.mode === 'grid' && axis === 'width' ? 'justify-self' : 'align-self'
    return [`${property}:stretch`]
  }
  const size = `${axis}:${lengthValue(length, axis)}`
  if (isMain) {
    // Fixed means fixed. Without this a 200px sidebar next to a filling body
    // shrinks with it, because every flex item shrinks by default.
    return [
      size,
      `flex-grow:${layout.grow ?? 0}`,
      `flex-shrink:${layout.shrink ?? 0}`,
      'flex-basis:auto',
    ]
  }
  return [size]
}

/**
 * Every layout field of a node as CSS declarations, for the node itself and for
 * the children it arranges.
 *
 * The renderer and the exporter both come through here. They used to carry a
 * copy each, and a copy of this drifts quietly: the canvas and the download
 * disagree about the design long before anyone notices.
 */
export function layoutDeclarations(
  layout: CanvasLayout,
  options: { parent?: LayoutParent; asRoot?: boolean } = {},
): string[] {
  const positioned = options.asRoot === true || layout.position === 'absolute'
  // An out-of-flow node is sized against its containing block, not against the
  // track or the flex line it was taken out of.
  const parent = positioned ? undefined : options.parent
  const declarations = [
    'box-sizing:border-box',
    `position:${positioned ? 'absolute' : 'relative'}`,
  ]
  if (positioned) declarations.push(`left:${layout.x}px`, `top:${layout.y}px`)
  declarations.push(
    ...axisDeclarations(layout, 'width', parent),
    ...axisDeclarations(layout, 'height', parent),
  )
  // A child may disagree with the alignment its parent hands every sibling.
  if (layout.alignSelf !== undefined && parent !== undefined) {
    declarations.push(`align-self:${flexAlignment(layout.alignSelf)}`)
  }
  const mainAxis =
    parent?.mode === 'flex' ? mainAxisFor[parent.direction ?? 'row'] : undefined
  // A share of the free space starts from zero, so the content floor has to
  // come off with it — otherwise one long word holds a column wider than its
  // share and the row overflows.
  const minWidth =
    layout.minWidth ??
    (mainAxis === 'width' && layout.width.unit === 'fill' ? 0 : undefined)
  const minHeight =
    layout.minHeight ??
    (mainAxis === 'height' && layout.height.unit === 'fill' ? 0 : undefined)
  if (minWidth !== undefined) declarations.push(`min-width:${minWidth}px`)
  if (layout.maxWidth !== undefined) declarations.push(`max-width:${layout.maxWidth}px`)
  if (minHeight !== undefined) declarations.push(`min-height:${minHeight}px`)
  if (layout.maxHeight !== undefined) declarations.push(`max-height:${layout.maxHeight}px`)
  if (layout.aspectRatio !== undefined) {
    declarations.push(`aspect-ratio:${layout.aspectRatio}`)
  }
  if (layout.mode === 'flex') {
    declarations.push(
      'display:flex',
      `flex-direction:${layout.direction ?? 'row'}`,
      `flex-wrap:${layout.wrap ? 'wrap' : 'nowrap'}`,
      `gap:${layout.gap ?? 0}px`,
      `align-items:${flexAlignment(layout.align ?? 'stretch')}`,
      `justify-content:${flexAlignment(layout.justify ?? 'start')}`,
    )
  } else if (layout.mode === 'grid') {
    const justify = layout.justify ?? 'stretch'
    declarations.push(
      'display:grid',
      `grid-template-columns:repeat(${Math.max(1, layout.columns ?? 1)},minmax(0,1fr))`,
      `gap:${layout.gap ?? 0}px`,
      `align-items:${layout.align ?? 'stretch'}`,
      // The tracks already consume the row, so `justify-content` has no free
      // space to distribute. The alignment anyone means here is the one inside
      // the track — except for the two values that only describe spacing
      // between tracks.
      justify.startsWith('space-')
        ? `justify-content:${justify}`
        : `justify-items:${justify}`,
    )
  }
  if (layout.padding) {
    declarations.push(
      `padding:${layout.padding.top}px ${layout.padding.right}px ${layout.padding.bottom}px ${layout.padding.left}px`,
    )
  }
  return declarations
}

/** The parent context a container hands the children it lays out. */
export function layoutParent(layout: CanvasLayout): LayoutParent {
  return { mode: layout.mode, direction: layout.direction }
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
