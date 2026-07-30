const STORAGE_KEY = 'loora:theme'
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * A concrete palette. `light` and `dark` are the built-in pair and carry no
 * `data-theme` attribute; the named themes layer their tokens on top of the
 * dark block through `html[data-theme='…']` in `styles.css`.
 */
export type ThemeId = 'light' | 'dark' | 'tokyo-night' | 'github-dark' | 'dracula'

/** What the user picked. `system` resolves to `light` or `dark` at apply time. */
export type ThemePreference = ThemeId | 'system'

export type ThemeMeta = {
  id: ThemeId
  label: string
  dark: boolean
  /** Drives the mobile browser chrome; matches the theme's canvas. */
  themeColor: string
  /** Canvas, panel surface, and accent, for the swatch in Appearance. */
  swatch: { canvas: string; surface: string; accent: string }
}

export const THEMES: ThemeMeta[] = [
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

const DEFAULT_THEME: ThemePreference = 'light'

const BY_ID = new Map(THEMES.map((theme) => [theme.id, theme]))

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || (value !== null && BY_ID.has(value as ThemeId))
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
  return BY_ID.get(id) ?? THEMES[0]
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
  else root.setAttribute('data-theme', theme.id)
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
    if (event.key === STORAGE_KEY) applyThemePreference()
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
    THEMES.map((theme) => [theme.id, { d: theme.dark ? 1 : 0, c: theme.themeColor }]),
  ),
)

// Runs before first paint so a stored or system preference cannot flash.
export const THEME_INIT_SCRIPT = `(()=>{const M=${INIT_THEMES};let t='${DEFAULT_THEME}';try{const s=localStorage.getItem(${JSON.stringify(
  STORAGE_KEY,
)});if(s==='system'||(s&&M[s]))t=s}catch(e){}const w=document.defaultView;const m=w&&w.matchMedia;if(t==='system')t=(m&&m.call(w,'${SYSTEM_DARK_QUERY}').matches)?'dark':'light';const e=M[t]||M.light;const r=document.documentElement;r.classList.toggle('dark',!!e.d);if(t==='light'||t==='dark')r.removeAttribute('data-theme');else r.setAttribute('data-theme',t);const c=document.querySelector('meta[name="theme-color"]');if(c)c.setAttribute('content',e.c);if(r.getAttribute('class')==='')r.removeAttribute('class')})()`
