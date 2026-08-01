import {
  CUSTOM_THEME_PREFIX,
  CUSTOM_THEME_VAR_NAMES,
  getCustomTheme,
  getCustomThemes,
  isCustomThemeId,
} from './custom-themes'

const STORAGE_KEY = 'loora:theme'
const CUSTOM_STORAGE_KEY = 'loora:custom-themes'
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * A concrete palette. `light` and `dark` are the built-in pair and carry no
 * `data-theme` attribute; the named themes layer their tokens on top of the
 * dark block through `html[data-theme='…']` in `styles.css`.
 */
export type BuiltInThemeId = 'light' | 'dark' | 'tokyo-night' | 'github-dark' | 'dracula'

/** A built-in palette, or `custom:<uuid>` for one saved in this browser. */
export type ThemeId = BuiltInThemeId | (string & {})

/** What the user picked. `system` resolves to `light` or `dark` at apply time. */
export type ThemePreference = ThemeId | 'system'

export type ThemeMeta = {
  id: ThemeId
  label: string
  /** Set for a theme saved in this browser; drives the inline custom properties. */
  vars?: Record<string, string>
  dark: boolean
  /** Drives the mobile browser chrome; matches the theme's canvas. */
  themeColor: string
  /** Canvas, panel surface, and accent, for the swatch in Appearance. */
  swatch: { canvas: string; surface: string; accent: string }
}

export const BUILT_IN_THEMES: ThemeMeta[] = [
  {
    id: 'light',
    label: 'Light',
    dark: false,
    themeColor: '#fafafa',
    swatch: { canvas: '#f4f4f5', surface: '#ffffff', accent: '#3f3f46' },
  },
  {
    id: 'dark',
    label: 'Dark',
    dark: true,
    themeColor: '#1d1c1b',
    swatch: { canvas: '#191918', surface: '#242321', accent: '#8fa8f8' },
  },
  {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    dark: true,
    themeColor: '#1a1b26',
    swatch: { canvas: '#16161e', surface: '#1a1b26', accent: '#7aa2f7' },
  },
  {
    id: 'github-dark',
    label: 'GitHub Dark',
    dark: true,
    themeColor: '#0d1117',
    swatch: { canvas: '#010409', surface: '#0d1117', accent: '#58a6ff' },
  },
  {
    id: 'dracula',
    label: 'Dracula',
    dark: true,
    themeColor: '#282a36',
    swatch: { canvas: '#21222c', surface: '#282a36', accent: '#bd93f9' },
  },
]

/** Kept for callers that only ever needed the built-ins. */
export const THEMES = BUILT_IN_THEMES

const DEFAULT_THEME: ThemePreference = 'light'

const BY_ID = new Map(BUILT_IN_THEMES.map((theme) => [theme.id, theme]))

/** A saved theme, described the way the built-ins are. */
function customThemeMeta(id: string): ThemeMeta | null {
  const custom = getCustomTheme(id)
  if (!custom) return null
  return {
    id: custom.id,
    label: custom.name,
    dark: custom.dark,
    themeColor: custom.colors.canvas,
    vars: custom.vars,
    swatch: {
      canvas: custom.colors.canvas,
      surface: custom.colors.surface,
      accent: custom.colors.accent,
    },
  }
}

/** Built-ins first, then whatever this browser has saved. */
export function listThemes(): ThemeMeta[] {
  return [
    ...BUILT_IN_THEMES,
    ...getCustomThemes().map((custom) => customThemeMeta(custom.id)!),
  ]
}

function isThemePreference(value: string | null): value is ThemePreference {
  if (value === null) return false
  if (value === 'system' || BY_ID.has(value)) return true
  return isCustomThemeId(value) && getCustomTheme(value) !== null
}

export function getThemePreference(): ThemePreference {
  try {
    const storage =
      globalThis.localStorage ?? globalThis.window?.localStorage ?? null
    const stored = storage?.getItem(STORAGE_KEY) ?? null
    return isThemePreference(stored) ? stored : DEFAULT_THEME
  } catch {
    // Storage can be unavailable in private browsing or blocked contexts.
    return DEFAULT_THEME
  }
}

function systemPrefersDark() {
  return globalThis.window?.matchMedia?.(SYSTEM_DARK_QUERY).matches === true
}

/** The palette a preference resolves to right now. */
export function resolveTheme(preference: ThemePreference): ThemeMeta {
  const id: ThemeId =
    preference === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : preference
  if (isCustomThemeId(id)) {
    // A deleted custom theme falls back rather than leaving the app unstyled.
    return customThemeMeta(id) ?? BUILT_IN_THEMES[0]!
  }
  return BY_ID.get(id) ?? BUILT_IN_THEMES[0]!
}

export function applyThemePreference(
  preference: ThemePreference = getThemePreference(),
) {
  if (typeof document === 'undefined') return
  const theme = resolveTheme(preference)
  const root = document.documentElement
  // Every named theme is a dark theme, so `dark:` utilities keep working; the
  // attribute only decides which token block wins.
  root.classList.toggle('dark', theme.dark)
  if (theme.id === 'light' || theme.id === 'dark') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme.vars ? 'custom' : theme.id)
  // A saved theme has no stylesheet block, so its tokens ride inline. Clear
  // them first: switching between themes must never leave a stale property.
  for (const name of CUSTOM_THEME_VAR_NAMES) root.style.removeProperty(name)
  if (theme.vars) {
    for (const [name, value] of Object.entries(theme.vars)) {
      root.style.setProperty(name, value)
    }
  }
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', theme.themeColor)
  if (root.getAttribute('class') === '') root.removeAttribute('class')
}

export function setThemePreference(preference: ThemePreference) {
  try {
    const storage =
      globalThis.localStorage ?? globalThis.window?.localStorage ?? null
    storage?.setItem(STORAGE_KEY, preference)
  } catch {
    // Applying the theme still works when persistence is unavailable.
  }
  applyThemePreference(preference)
}

export function syncThemePreference() {
  applyThemePreference()
  if (typeof window === 'undefined') return () => {}

  const media = window.matchMedia?.(SYSTEM_DARK_QUERY)
  const handleSystemChange = () => {
    if (getThemePreference() === 'system') applyThemePreference('system')
  }
  const handleStorage = (event: StorageEvent) => {
    // Editing a custom theme in another tab changes the palette, not the pick.
    if (event.key === STORAGE_KEY || event.key === CUSTOM_STORAGE_KEY) {
      applyThemePreference()
    }
  }

  media?.addEventListener('change', handleSystemChange)
  window.addEventListener('storage', handleStorage)

  return () => {
    media?.removeEventListener('change', handleSystemChange)
    window.removeEventListener('storage', handleStorage)
  }
}

const INIT_THEMES = JSON.stringify(
  Object.fromEntries(
    BUILT_IN_THEMES.map((theme) => [theme.id, { d: theme.dark ? 1 : 0, c: theme.themeColor }]),
  ),
)

/**
 * Runs before first paint so a stored or system preference cannot flash. A
 * custom theme is applied from the properties saved with it — the derivation
 * itself stays in the bundle.
 */
export const THEME_INIT_SCRIPT = `(()=>{const M=${INIT_THEMES};const P=${JSON.stringify(
  CUSTOM_THEME_PREFIX,
)};let t='${DEFAULT_THEME}';let C=null;try{const s=localStorage.getItem(${JSON.stringify(
  STORAGE_KEY,
)});if(s==='system'||(s&&M[s]))t=s;else if(s&&s.indexOf(P)===0){const list=JSON.parse(localStorage.getItem(${JSON.stringify(
  CUSTOM_STORAGE_KEY,
)})||'[]');const hit=Array.isArray(list)&&list.find(x=>x&&x.id===s);if(hit&&hit.vars){t=s;C=hit}}}catch(e){}const w=document.defaultView;const m=w&&w.matchMedia;if(t==='system')t=(m&&m.call(w,'${SYSTEM_DARK_QUERY}').matches)?'dark':'light';const r=document.documentElement;if(C){r.classList.toggle('dark',C.dark!==false);r.setAttribute('data-theme','custom');for(const k in C.vars){if(k.indexOf('--')===0&&typeof C.vars[k]==='string')r.style.setProperty(k,C.vars[k])}const cc=document.querySelector('meta[name="theme-color"]');if(cc&&C.colors&&C.colors.canvas)cc.setAttribute('content',C.colors.canvas)}else{const e=M[t]||M.light;r.classList.toggle('dark',!!e.d);if(t==='light'||t==='dark')r.removeAttribute('data-theme');else r.setAttribute('data-theme',t);const c=document.querySelector('meta[name="theme-color"]');if(c)c.setAttribute('content',e.c)}if(r.getAttribute('class')==='')r.removeAttribute('class')})()`
