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
