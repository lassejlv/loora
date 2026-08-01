const STORAGE_KEY = 'loora:custom-themes'

export const CUSTOM_THEME_PREFIX = 'custom:'

/** The five colours a person actually picks; everything else is derived. */
export type CustomThemeColors = {
  canvas: string
  surface: string
  line: string
  ink: string
  accent: string
}

export type CustomTheme = {
  id: string
  name: string
  /** Decides the `dark` class, so `dark:` utilities and shadows stay coherent. */
  dark: boolean
  colors: CustomThemeColors
  /**
   * The derived custom properties, stored with the theme. The pre-paint init
   * script can then apply a theme without shipping the derivation itself.
   */
  vars: Record<string, string>
}

const HEX = /^#[0-9a-f]{6}$/i

export function isCustomThemeId(id: string) {
  return id.startsWith(CUSTOM_THEME_PREFIX)
}

const mix = (color: string, into: string, amount: number) =>
  `color-mix(in oklab, ${color} ${amount}%, ${into})`

const alpha = (color: string, amount: number) =>
  `color-mix(in oklab, ${color} ${amount}%, transparent)`

/**
 * Expands the picked colours into the token set the app reads. Semantic
 * colours (destructive, success, warning, diff) are deliberately left to the
 * base light/dark block: a custom palette should not be able to make an error
 * look like a success.
 */
export function deriveThemeVars(colors: CustomThemeColors, dark: boolean) {
  const { canvas, surface, line, ink, accent } = colors
  const surface2 = mix(ink, surface, 6)
  return {
    '--cx-canvas': canvas,
    '--cx-dot': mix(ink, line, 20),
    '--cx-ink': ink,
    '--cx-accent': accent,
    '--background': canvas,
    '--foreground': ink,
    '--card': surface,
    '--card-foreground': ink,
    '--popover': surface2,
    '--popover-foreground': ink,
    '--primary': accent,
    '--primary-foreground': canvas,
    '--secondary': alpha(ink, 8),
    '--secondary-foreground': ink,
    '--muted': alpha(ink, 6),
    '--muted-foreground': mix(ink, canvas, 62),
    '--accent': alpha(accent, dark ? 16 : 12),
    '--accent-foreground': ink,
    '--border': line,
    '--input': mix(ink, line, 22),
    '--ring': accent,
    '--sidebar': canvas,
    '--sidebar-foreground': ink,
    '--sidebar-primary': accent,
    '--sidebar-primary-foreground': canvas,
    '--sidebar-accent': alpha(ink, 8),
    '--sidebar-accent-foreground': ink,
    '--sidebar-border': line,
    '--sidebar-ring': accent,
    '--surface': surface,
    '--surface-2': surface2,
    '--line': line,
  } satisfies Record<string, string>
}

/** Every property a custom theme can set, so switching away clears all of it. */
export const CUSTOM_THEME_VAR_NAMES = Object.keys(
  deriveThemeVars(
    { canvas: '#000000', surface: '#000000', line: '#000000', ink: '#000000', accent: '#000000' },
    true,
  ),
)

function normalizeColors(input: unknown, fallback: CustomThemeColors): CustomThemeColors {
  const raw = (input ?? {}) as Partial<Record<keyof CustomThemeColors, unknown>>
  const pick = (key: keyof CustomThemeColors) => {
    const value = raw[key]
    return typeof value === 'string' && HEX.test(value) ? value : fallback[key]
  }
  return {
    canvas: pick('canvas'),
    surface: pick('surface'),
    line: pick('line'),
    ink: pick('ink'),
    accent: pick('accent'),
  }
}

export const DARK_PRESET: CustomThemeColors = {
  canvas: '#191918',
  surface: '#242321',
  line: '#393834',
  ink: '#efede8',
  accent: '#8fa8f8',
}

export const LIGHT_PRESET: CustomThemeColors = {
  canvas: '#f4f4f5',
  surface: '#ffffff',
  line: '#e4e4e7',
  ink: '#18181b',
  accent: '#3f3f46',
}

/** Builds a stored theme from a name, a base, and the picked colours. */
export function makeCustomTheme(
  input: { id?: string; name: string; dark: boolean; colors: CustomThemeColors },
): CustomTheme {
  const colors = normalizeColors(input.colors, input.dark ? DARK_PRESET : LIGHT_PRESET)
  return {
    id: input.id ?? `${CUSTOM_THEME_PREFIX}${crypto.randomUUID()}`,
    name: input.name.trim() || 'Custom',
    dark: input.dark,
    colors,
    vars: deriveThemeVars(colors, input.dark),
  }
}

function normalizeTheme(input: unknown): CustomTheme | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Partial<CustomTheme>
  if (typeof raw.id !== 'string' || !isCustomThemeId(raw.id)) return null
  if (typeof raw.name !== 'string') return null
  // Vars are re-derived on read: a hand-edited or older entry can never inject
  // an arbitrary declaration into the document.
  return makeCustomTheme({
    id: raw.id,
    name: raw.name,
    dark: raw.dark !== false,
    colors: normalizeColors(raw.colors, raw.dark === false ? LIGHT_PRESET : DARK_PRESET),
  })
}

export function getCustomThemes(): CustomTheme[] {
  try {
    const storage = globalThis.localStorage ?? globalThis.window?.localStorage ?? null
    const raw = storage?.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeTheme).filter((theme): theme is CustomTheme => theme !== null)
  } catch {
    // Malformed or unavailable storage means no custom themes, never a crash.
    return []
  }
}

export function getCustomTheme(id: string): CustomTheme | null {
  return getCustomThemes().find((theme) => theme.id === id) ?? null
}

function write(themes: CustomTheme[]) {
  try {
    const storage = globalThis.localStorage ?? globalThis.window?.localStorage ?? null
    storage?.setItem(STORAGE_KEY, JSON.stringify(themes))
  } catch {
    // Nothing to persist to; the applied theme still stands for this session.
  }
}

/** Adds or replaces a theme, keeping list order stable for editors. */
export function saveCustomTheme(theme: CustomTheme): CustomTheme[] {
  const themes = getCustomThemes()
  const index = themes.findIndex((item) => item.id === theme.id)
  const next =
    index === -1
      ? [...themes, theme]
      : themes.map((item, at) => (at === index ? theme : item))
  write(next)
  return next
}

export function deleteCustomTheme(id: string): CustomTheme[] {
  const next = getCustomThemes().filter((theme) => theme.id !== id)
  write(next)
  return next
}
