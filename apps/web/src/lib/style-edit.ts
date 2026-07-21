// Class-token surgery for the inline style editor. A node's class attribute
// value appears verbatim in the element source (HTML class= / JSX className=),
// so a style change is: swap tokens in the string, then exact-replace the old
// value with the new one in the code.

const COLOR_NAMES =
  '(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)'

// text-[#…]/text-[rgb…] are colors; text-[14px] is a size — the bracket
// prefix disambiguates.
const ARBITRARY_COLOR = '\\[(#|rgb|hsl|var|oklch)[^\\]]*\\]'

export const TEXT_COLOR_RE = new RegExp(
  `^text-(${ARBITRARY_COLOR}|white|black|transparent|current|inherit|${COLOR_NAMES}-\\d+)(/\\d+)?$`,
)
export const BG_COLOR_RE = new RegExp(
  `^bg-(${ARBITRARY_COLOR}|white|black|transparent|current|inherit|${COLOR_NAMES}-\\d+)(/\\d+)?$`,
)
export const FONT_SIZE_RE = /^text-(xs|sm|base|lg|xl|[2-9]xl)$/
export const FONT_WEIGHT_RE = /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/
// font-sans/serif/mono plus arbitrary families (font-[Playfair_Display]);
// a leading digit means an arbitrary font-WEIGHT (font-[600]), not a family.
export const FONT_FAMILY_RE = /^font-(sans|serif|mono|\[(?!\d)[^\]]+\])$/
export const RADIUS_RE = /^rounded(-(none|xs|sm|md|lg|xl|2xl|3xl|4xl|full))?$/

export type StyleTokenKind =
  | 'textColor'
  | 'bgColor'
  | 'fontSize'
  | 'fontWeight'
  | 'fontFamily'
  | 'radius'

const KIND_RES: Record<StyleTokenKind, RegExp> = {
  textColor: TEXT_COLOR_RE,
  bgColor: BG_COLOR_RE,
  fontSize: FONT_SIZE_RE,
  fontWeight: FONT_WEIGHT_RE,
  fontFamily: FONT_FAMILY_RE,
  radius: RADIUS_RE,
}

export function getStyleToken(className: string, kind: StyleTokenKind): string | null {
  return className.split(/\s+/).find((t) => KIND_RES[kind].test(t)) ?? null
}

// ---------------------------------------------------------------------------
// Spacing (padding / gap) — numeric Tailwind scale steps.

export const SPACING_SCALE = [0, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32] as const

export type SpacingKind = 'px' | 'py' | 'gap'

const NUM = '(\\d+(?:\\.\\d+)?)'
const PX_RE = new RegExp(`^px-${NUM}$`)
const PY_RE = new RegExp(`^py-${NUM}$`)
const P_RE = new RegExp(`^p-${NUM}$`)
const GAP_RE = new RegExp(`^gap-${NUM}$`)
// Anything padding/gap-ish we replace when writing, including arbitrary values.
const PAD_ANY_RE = /^(p|px|py)-(\d+(\.\d+)?|px|\[[^\]]+\])$/
const GAP_ANY_RE = /^gap(-[xy])?-(\d+(\.\d+)?|px|\[[^\]]+\])$/

function num(match: RegExpMatchArray | null): number | null {
  return match ? Number(match[1]) : null
}

/** Current spacing value on the scale, reading p-N as both axes. Null when unset or arbitrary. */
export function getSpacing(className: string, kind: SpacingKind): number | null {
  const tokens = className.split(/\s+/)
  if (kind === 'gap') {
    for (const t of tokens) {
      const v = num(t.match(GAP_RE))
      if (v !== null) return v
    }
    return null
  }
  const axisRe = kind === 'px' ? PX_RE : PY_RE
  let fallback: number | null = null
  for (const t of tokens) {
    const axis = num(t.match(axisRe))
    if (axis !== null) return axis
    const both = num(t.match(P_RE))
    if (both !== null) fallback = both
  }
  return fallback
}

/**
 * Set one spacing value. Padding writes decompose p-N into px/py so changing
 * one axis never loses the other, then re-merge into p-N when both agree.
 * Side-specific tokens (pt-*, pl-*, …) are left alone.
 */
export function setSpacing(className: string, kind: SpacingKind, value: number | null): string {
  const tokens = className.split(/\s+/).filter(Boolean)
  const fmt = (v: number) => String(v)
  if (kind === 'gap') {
    const at = tokens.findIndex((t) => GAP_ANY_RE.test(t))
    const kept = tokens.filter((t) => !GAP_ANY_RE.test(t))
    if (value !== null) kept.splice(at === -1 ? kept.length : Math.min(at, kept.length), 0, `gap-${fmt(value)}`)
    return kept.join(' ')
  }
  const curX = kind === 'px' ? value : getSpacing(className, 'px')
  const curY = kind === 'py' ? value : getSpacing(className, 'py')
  const at = tokens.findIndex((t) => PAD_ANY_RE.test(t))
  const kept = tokens.filter((t) => !PAD_ANY_RE.test(t))
  const next: string[] = []
  if (curX !== null && curX === curY) next.push(`p-${fmt(curX)}`)
  else {
    if (curX !== null) next.push(`px-${fmt(curX)}`)
    if (curY !== null) next.push(`py-${fmt(curY)}`)
  }
  kept.splice(at === -1 ? kept.length : Math.min(at, kept.length), 0, ...next)
  return kept.join(' ')
}

/** Next/previous stop on the spacing scale from the current value. */
export function stepSpacing(current: number | null, direction: 1 | -1): number {
  if (current === null) return direction === 1 ? 4 : 0
  if (direction === 1) {
    for (const stop of SPACING_SCALE) if (stop > current) return stop
    return SPACING_SCALE[SPACING_SCALE.length - 1]
  }
  for (let i = SPACING_SCALE.length - 1; i >= 0; i--) {
    if (SPACING_SCALE[i] < current) return SPACING_SCALE[i]
  }
  return 0
}

/**
 * Replace (or remove, with token = null) every class of the given kind,
 * keeping all other classes and their order. The new token lands where the
 * first replaced class sat, or at the end when none existed.
 */
export function setStyleToken(
  className: string,
  kind: StyleTokenKind,
  token: string | null,
): string {
  const re = KIND_RES[kind]
  const tokens = className.split(/\s+/).filter(Boolean)
  const at = tokens.findIndex((t) => re.test(t))
  const kept = tokens.filter((t) => !re.test(t))
  if (token) kept.splice(at === -1 ? kept.length : Math.min(at, kept.length), 0, token)
  return kept.join(' ')
}
