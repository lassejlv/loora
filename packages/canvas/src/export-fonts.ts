/**
 * Self-hosted Canvas typefaces (apps/web/public/vendor/fonts).
 * Keep faces in sync with scripts/vendor-fonts.py / fonts.css.
 */

const LATIN_EXT =
  'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF'

const LATIN =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'

const VENDOR_FONTS = [
  { family: 'Archivo', file: 'archivo' },
  { family: 'Inter', file: 'inter' },
  { family: 'Lora', file: 'lora' },
  { family: 'Playfair Display', file: 'playfair-display' },
  { family: 'Space Grotesk', file: 'space-grotesk' },
  { family: 'Spline Sans Mono', file: 'spline-sans-mono' },
] as const

const VENDOR_BY_FAMILY = new Map(
  VENDOR_FONTS.map((font) => [font.family.toLowerCase(), font]),
)

/** Split a CSS font-family list into bare family names. */
export function parseFontFamilyNames(value: string): string[] {
  const names: string[] = []
  for (const part of value.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const quoted = trimmed.match(/^(['"])(.*)\1$/)
    names.push((quoted ? quoted[2] : trimmed).trim())
  }
  return names.filter(Boolean)
}

function faceCss(
  family: string,
  fileStem: string,
  subset: 'latin' | 'latin-ext',
  unicodeRange: string,
  basePath: string,
) {
  return (
    `@font-face{font-family:'${family}';font-style:normal;font-weight:100 900;` +
    `font-display:swap;src:url(${basePath}/${fileStem}-${subset}.woff2) format('woff2');` +
    `unicode-range:${unicodeRange}}`
  )
}

/**
 * @font-face rules for every vendored family named in `families`.
 * `fontOrigin` makes src absolute (e.g. https://loora.design); omit for
 * same-origin `/vendor/fonts/…` paths (published sites on the app host).
 */
export function vendorFontFaceCss(
  families: Iterable<string>,
  fontOrigin?: string,
): string {
  const needed = new Set<string>()
  for (const value of families) {
    for (const name of parseFontFamilyNames(value)) {
      const font = VENDOR_BY_FAMILY.get(name.toLowerCase())
      if (font) needed.add(font.family)
    }
  }
  if (needed.size === 0) return ''

  const origin = fontOrigin?.trim().replace(/\/+$/, '') ?? ''
  const basePath = origin ? `${origin}/vendor/fonts` : '/vendor/fonts'
  const faces: string[] = []
  for (const font of VENDOR_FONTS) {
    if (!needed.has(font.family)) continue
    faces.push(
      faceCss(font.family, font.file, 'latin-ext', LATIN_EXT, basePath),
      faceCss(font.family, font.file, 'latin', LATIN, basePath),
    )
  }
  return faces.join('')
}
