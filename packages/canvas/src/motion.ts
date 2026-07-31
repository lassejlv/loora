/**
 * Motion: what a node does over time.
 *
 * Two separate ideas, deliberately kept apart.
 *
 * A **transition** answers "how does this node get from one look to another",
 * and is what makes a hover feel like a movement rather than a jump. A node
 * carries one, and it applies to whatever its visual states change.
 *
 * An **animation** is a named sequence of keyframes held once at the document
 * level, like a design token, and referenced by any number of nodes. Defining
 * it once is what lets "fade in up" mean the same thing across a design, and
 * what lets an agent apply a house style in one call.
 *
 * Everything here is structured values — durations in milliseconds, easings
 * from a fixed set or an explicit cubic bezier, keyframes as offsets with
 * numeric deltas. There is no CSS string anywhere, because the canvas model
 * never accepts one; the CSS is generated from these values, by this file, for
 * both the editor and the export. Sharing that generator is what makes the
 * canvas show what the export will do.
 *
 * Keyframes move opacity and transform only. Those two composite on the GPU
 * without touching layout, which is what keeps an animated canvas smooth — and
 * it keeps the exported CSS to something a browser can run at 60fps rather than
 * a promise the model cannot keep.
 */

export type AnimationId = string

export type CanvasEasingName =
  | 'linear'
  | 'ease'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'

export type CanvasEasing =
  | CanvasEasingName
  /** Four control points, as CSS `cubic-bezier()` takes them. */
  | { cubicBezier: [number, number, number, number] }

/** What a transition is allowed to watch, as groups rather than raw CSS names. */
export type TransitionProperty =
  | 'all'
  | 'opacity'
  | 'transform'
  | 'colors'
  | 'size'
  | 'shadow'
  | 'border'

export interface CanvasTransition {
  /** Milliseconds. */
  duration: number
  delay?: number
  easing: CanvasEasing
  /** Defaults to `['all']`. */
  properties?: TransitionProperty[]
}

/**
 * The transform half of a keyframe. Offsets are in pixels, rotation and skew in
 * degrees, scale is a multiplier.
 */
export interface CanvasMotionTransform {
  x?: number
  y?: number
  scale?: number
  scaleX?: number
  scaleY?: number
  rotate?: number
  skewX?: number
  skewY?: number
}

export interface CanvasKeyframe {
  /** 0 to 1, where the frame sits in the animation. */
  offset: number
  opacity?: number
  transform?: CanvasMotionTransform
}

export type AnimationDirection =
  | 'normal'
  | 'reverse'
  | 'alternate'
  | 'alternate-reverse'

export type AnimationFill = 'none' | 'forwards' | 'backwards' | 'both'

export interface CanvasAnimation {
  id: AnimationId
  name: string
  keyframes: CanvasKeyframe[]
  /** Milliseconds. */
  duration: number
  delay?: number
  easing: CanvasEasing
  iterations: number | 'infinite'
  direction: AnimationDirection
  fill: AnimationFill
}

/**
 * What starts an animation on a node.
 *
 * `load` plays once when the node renders, `in-view` waits until it is scrolled
 * into view, `always` loops from the start, and `hover` / `press` play while a
 * pointer is on or held down. Anything continuous belongs on `always` with
 * `iterations: 'infinite'`.
 */
export type AnimationTrigger = 'load' | 'in-view' | 'always' | 'hover' | 'press'

export interface CanvasNodeAnimation {
  animationId: AnimationId
  trigger: AnimationTrigger
  /** Added to the animation's own delay — this is where a stagger comes from. */
  delay?: number
  /** For `in-view`: play the first time it appears and not again. */
  once?: boolean
}

/** The looks a pointer can put a node into, each carrying a node patch. */
export const VISUAL_STATES = ['hover', 'press', 'focus'] as const
export type VisualStateName = (typeof VISUAL_STATES)[number]

export const MAX_KEYFRAMES = 40
export const MAX_NODE_ANIMATIONS = 8
export const MAX_ANIMATIONS = 200
export const MAX_DURATION_MS = 60_000
export const MAX_ITERATIONS = 1_000

const EASING_NAMES = new Set<string>([
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
])

const TRANSITION_PROPERTIES = new Set<string>([
  'all',
  'opacity',
  'transform',
  'colors',
  'size',
  'shadow',
  'border',
])

const TRIGGERS = new Set<string>(['load', 'in-view', 'always', 'hover', 'press'])
const DIRECTIONS = new Set<string>([
  'normal',
  'reverse',
  'alternate',
  'alternate-reverse',
])
const FILLS = new Set<string>(['none', 'forwards', 'backwards', 'both'])
const TRANSFORM_FIELDS = [
  'x',
  'y',
  'scale',
  'scaleX',
  'scaleY',
  'rotate',
  'skewX',
  'skewY',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function inRange(value: unknown, min: number, max: number): value is number {
  return finite(value) && value >= min && value <= max
}

export function isCanvasEasing(value: unknown): value is CanvasEasing {
  if (typeof value === 'string') return EASING_NAMES.has(value)
  if (!isRecord(value) || Object.keys(value).length !== 1) return false
  const points = value.cubicBezier
  return (
    Array.isArray(points) &&
    points.length === 4 &&
    points.every((point) => finite(point) && Math.abs(point) <= 10) &&
    // The x controls are time; outside 0..1 the curve is not a function.
    inRange(points[0], 0, 1) &&
    inRange(points[2], 0, 1)
  )
}

export function isCanvasTransition(value: unknown): value is CanvasTransition {
  if (!isRecord(value)) return false
  if (Object.keys(value).some((key) => !['duration', 'delay', 'easing', 'properties'].includes(key))) {
    return false
  }
  if (!inRange(value.duration, 0, MAX_DURATION_MS)) return false
  if (value.delay !== undefined && !inRange(value.delay, 0, MAX_DURATION_MS)) {
    return false
  }
  if (!isCanvasEasing(value.easing)) return false
  if (value.properties !== undefined) {
    if (
      !Array.isArray(value.properties) ||
      value.properties.length === 0 ||
      value.properties.length > TRANSITION_PROPERTIES.size ||
      value.properties.some((property) => !TRANSITION_PROPERTIES.has(property as string))
    ) {
      return false
    }
  }
  return true
}

export function isCanvasMotionTransform(
  value: unknown,
): value is CanvasMotionTransform {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  if (keys.length === 0 || keys.length > TRANSFORM_FIELDS.length) return false
  return keys.every((key) => {
    if (!(TRANSFORM_FIELDS as readonly string[]).includes(key)) return false
    const amount = value[key]
    if (key === 'x' || key === 'y') return inRange(amount, -100_000, 100_000)
    if (key === 'scale' || key === 'scaleX' || key === 'scaleY') {
      return inRange(amount, 0, 100)
    }
    return inRange(amount, -3_600, 3_600)
  })
}

export function isCanvasKeyframe(value: unknown): value is CanvasKeyframe {
  if (!isRecord(value)) return false
  if (Object.keys(value).some((key) => !['offset', 'opacity', 'transform'].includes(key))) {
    return false
  }
  if (!inRange(value.offset, 0, 1)) return false
  if (value.opacity !== undefined && !inRange(value.opacity, 0, 1)) return false
  if (value.transform !== undefined && !isCanvasMotionTransform(value.transform)) {
    return false
  }
  return value.opacity !== undefined || value.transform !== undefined
}

export function isCanvasAnimation(value: unknown): value is CanvasAnimation {
  if (!isRecord(value)) return false
  if (
    Object.keys(value).some(
      (key) =>
        ![
          'id',
          'name',
          'keyframes',
          'duration',
          'delay',
          'easing',
          'iterations',
          'direction',
          'fill',
        ].includes(key),
    )
  ) {
    return false
  }
  if (
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    value.id.length > 128 ||
    typeof value.name !== 'string' ||
    value.name.length === 0 ||
    value.name.length > 200
  ) {
    return false
  }
  if (
    !Array.isArray(value.keyframes) ||
    value.keyframes.length < 2 ||
    value.keyframes.length > MAX_KEYFRAMES ||
    !value.keyframes.every(isCanvasKeyframe)
  ) {
    return false
  }
  // Offsets ascend, so the sequence reads in the order it plays.
  const offsets = (value.keyframes as CanvasKeyframe[]).map((frame) => frame.offset)
  if (offsets.some((offset, index) => index > 0 && offset <= offsets[index - 1]!)) {
    return false
  }
  if (!inRange(value.duration, 1, MAX_DURATION_MS)) return false
  if (value.delay !== undefined && !inRange(value.delay, 0, MAX_DURATION_MS)) {
    return false
  }
  if (!isCanvasEasing(value.easing)) return false
  if (
    value.iterations !== 'infinite' &&
    !(inRange(value.iterations, 1, MAX_ITERATIONS) && Number.isInteger(value.iterations))
  ) {
    return false
  }
  return (
    DIRECTIONS.has(value.direction as string) && FILLS.has(value.fill as string)
  )
}

export function isCanvasNodeAnimation(
  value: unknown,
): value is CanvasNodeAnimation {
  if (!isRecord(value)) return false
  if (
    Object.keys(value).some(
      (key) => !['animationId', 'trigger', 'delay', 'once'].includes(key),
    )
  ) {
    return false
  }
  return (
    typeof value.animationId === 'string' &&
    value.animationId.length > 0 &&
    value.animationId.length <= 128 &&
    TRIGGERS.has(value.trigger as string) &&
    (value.delay === undefined || inRange(value.delay, 0, MAX_DURATION_MS)) &&
    (value.once === undefined || typeof value.once === 'boolean')
  )
}

/* -------------------------------------------------------------------------- */
/* CSS                                                                        */
/* -------------------------------------------------------------------------- */

const PROPERTY_CSS: Record<TransitionProperty, string> = {
  all: 'all',
  opacity: 'opacity',
  transform: 'transform',
  colors: 'background-color, border-color, color, fill, stroke',
  size: 'width, height',
  shadow: 'box-shadow',
  border: 'border-color, border-width',
}

export function easingCss(easing: CanvasEasing) {
  return typeof easing === 'string'
    ? easing
    : `cubic-bezier(${easing.cubicBezier.join(',')})`
}

export function transformCss(transform: CanvasMotionTransform) {
  const parts: string[] = []
  if (transform.x !== undefined || transform.y !== undefined) {
    parts.push(`translate(${transform.x ?? 0}px,${transform.y ?? 0}px)`)
  }
  if (transform.scale !== undefined) parts.push(`scale(${transform.scale})`)
  if (transform.scaleX !== undefined) parts.push(`scaleX(${transform.scaleX})`)
  if (transform.scaleY !== undefined) parts.push(`scaleY(${transform.scaleY})`)
  if (transform.rotate !== undefined) parts.push(`rotate(${transform.rotate}deg)`)
  if (transform.skewX !== undefined) parts.push(`skewX(${transform.skewX}deg)`)
  if (transform.skewY !== undefined) parts.push(`skewY(${transform.skewY}deg)`)
  return parts.length > 0 ? parts.join(' ') : 'none'
}

export function transitionCss(transition: CanvasTransition) {
  const properties = transition.properties?.length
    ? transition.properties
    : (['all'] as TransitionProperty[])
  const timing = `${transition.duration}ms ${easingCss(transition.easing)}${
    transition.delay ? ` ${transition.delay}ms` : ''
  }`
  return properties
    .flatMap((property) => PROPERTY_CSS[property].split(', '))
    .map((name) => `${name} ${timing}`)
    .join(', ')
}

/** The `@keyframes` block for one animation, named after its id. */
export function keyframesCss(animation: CanvasAnimation) {
  const frames = animation.keyframes
    .map((frame) => {
      const declarations: string[] = []
      if (frame.opacity !== undefined) declarations.push(`opacity:${frame.opacity}`)
      if (frame.transform) declarations.push(`transform:${transformCss(frame.transform)}`)
      return `${Math.round(frame.offset * 100)}%{${declarations.join(';')}}`
    })
    .join('')
  return `@keyframes ${keyframesName(animation.id)}{${frames}}`
}

export function keyframesName(id: AnimationId) {
  return `loora-motion-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

/** The `animation` shorthand for one node's use of one animation. */
export function animationCss(
  animation: CanvasAnimation,
  use: CanvasNodeAnimation,
) {
  const delay = (animation.delay ?? 0) + (use.delay ?? 0)
  return [
    keyframesName(animation.id),
    `${animation.duration}ms`,
    easingCss(animation.easing),
    `${delay}ms`,
    animation.iterations === 'infinite' ? 'infinite' : String(animation.iterations),
    animation.direction,
    animation.fill,
  ].join(' ')
}

/* -------------------------------------------------------------------------- */
/* Presets                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The motions people actually ask for, so "make it fade in" is one call rather
 * than a keyframe table. Each is a complete animation: an agent adds it to the
 * document by name and points nodes at it.
 */
export const MOTION_PRESETS = {
  'fade-in': {
    name: 'Fade in',
    duration: 400,
    easing: 'ease-out',
    keyframes: [{ offset: 0, opacity: 0 }, { offset: 1, opacity: 1 }],
  },
  'fade-in-up': {
    name: 'Fade in up',
    duration: 500,
    easing: 'ease-out',
    keyframes: [
      { offset: 0, opacity: 0, transform: { y: 16 } },
      { offset: 1, opacity: 1, transform: { y: 0 } },
    ],
  },
  'fade-in-down': {
    name: 'Fade in down',
    duration: 500,
    easing: 'ease-out',
    keyframes: [
      { offset: 0, opacity: 0, transform: { y: -16 } },
      { offset: 1, opacity: 1, transform: { y: 0 } },
    ],
  },
  'slide-in-left': {
    name: 'Slide in from the left',
    duration: 500,
    easing: 'ease-out',
    keyframes: [
      { offset: 0, opacity: 0, transform: { x: -32 } },
      { offset: 1, opacity: 1, transform: { x: 0 } },
    ],
  },
  'slide-in-right': {
    name: 'Slide in from the right',
    duration: 500,
    easing: 'ease-out',
    keyframes: [
      { offset: 0, opacity: 0, transform: { x: 32 } },
      { offset: 1, opacity: 1, transform: { x: 0 } },
    ],
  },
  'scale-in': {
    name: 'Scale in',
    duration: 350,
    easing: { cubicBezier: [0.16, 1, 0.3, 1] },
    keyframes: [
      { offset: 0, opacity: 0, transform: { scale: 0.94 } },
      { offset: 1, opacity: 1, transform: { scale: 1 } },
    ],
  },
  pulse: {
    name: 'Pulse',
    duration: 2_000,
    easing: 'ease-in-out',
    iterations: 'infinite',
    keyframes: [
      { offset: 0, opacity: 1 },
      { offset: 0.5, opacity: 0.55 },
      { offset: 1, opacity: 1 },
    ],
  },
  float: {
    name: 'Float',
    duration: 4_000,
    easing: 'ease-in-out',
    iterations: 'infinite',
    keyframes: [
      { offset: 0, transform: { y: 0 } },
      { offset: 0.5, transform: { y: -8 } },
      { offset: 1, transform: { y: 0 } },
    ],
  },
  spin: {
    name: 'Spin',
    duration: 1_200,
    easing: 'linear',
    iterations: 'infinite',
    keyframes: [
      { offset: 0, transform: { rotate: 0 } },
      { offset: 1, transform: { rotate: 360 } },
    ],
  },
} as const satisfies Record<
  string,
  {
    name: string
    duration: number
    easing: CanvasEasing
    iterations?: number | 'infinite'
    keyframes: readonly CanvasKeyframe[]
  }
>

export type MotionPresetName = keyof typeof MOTION_PRESETS

export const MOTION_PRESET_NAMES = Object.keys(MOTION_PRESETS) as MotionPresetName[]

/** Builds a document animation from a preset, under an id of your choosing. */
export function motionPreset(
  preset: MotionPresetName,
  id: AnimationId = preset,
): CanvasAnimation {
  const source = MOTION_PRESETS[preset]
  const iterations = 'iterations' in source ? source.iterations : 1
  return {
    id,
    name: source.name,
    keyframes: source.keyframes.map((frame) => ({ ...frame })),
    duration: source.duration,
    easing: source.easing,
    iterations: iterations as number | 'infinite',
    direction: 'normal',
    // `backwards`, not `both`. A filled animation outranks every author rule
    // for the properties it touches, so an entrance that holds its last frame
    // silently kills any hover that moves the same node — the shadow would
    // apply and the lift would not. Each entrance here ends on the resting
    // style anyway, so releasing it changes nothing on screen and hands the
    // property back. `backwards` still holds the first frame through a delay,
    // which is what keeps a staggered list from flashing into view early.
    fill: iterations === 'infinite' ? 'none' : 'backwards',
  }
}
