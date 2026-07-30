const STORAGE_KEY = 'loora:theme'

export type ThemePreference = 'light' | 'dark' | 'system'

const DEFAULT_THEME: ThemePreference = 'light'
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)'
const LIGHT_THEME_COLOR = '#fafafa'
const DARK_THEME_COLOR = '#1d1c1b'

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
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

export function applyThemePreference(
  preference: ThemePreference = getThemePreference(),
) {
  if (typeof document !== 'undefined') {
    const dark =
      preference === 'dark' ||
      (preference === 'system' && systemPrefersDark())
    document.documentElement.classList.toggle('dark', dark)
    document
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute('content', dark ? DARK_THEME_COLOR : LIGHT_THEME_COLOR)
    if (document.documentElement.getAttribute('class') === '') {
      document.documentElement.removeAttribute('class')
    }
  }
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

// Runs before first paint so a stored or system preference cannot flash light.
export const THEME_INIT_SCRIPT = `(()=>{let t='${DEFAULT_THEME}';try{const s=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});if(s==='light'||s==='dark'||s==='system')t=s}catch(e){}const m=document.defaultView&&document.defaultView.matchMedia;const d=t==='dark'||(t==='system'&&m&&m.call(document.defaultView,'${SYSTEM_DARK_QUERY}').matches);document.documentElement.classList.toggle('dark',!!d);const c=document.querySelector('meta[name="theme-color"]');if(c)c.setAttribute('content',d?'${DARK_THEME_COLOR}':'${LIGHT_THEME_COLOR}');if(document.documentElement.getAttribute('class')==='')document.documentElement.removeAttribute('class')})()`
