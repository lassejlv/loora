import { useSyncExternalStore } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'loora:theme'

export function getThemePreference(): ThemePreference {
  if (typeof localStorage === 'undefined') return 'system'
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw === 'light' || raw === 'dark' ? raw : 'system'
}

export function setThemePreference(preference: ThemePreference) {
  if (preference === 'system') localStorage.removeItem(STORAGE_KEY)
  else localStorage.setItem(STORAGE_KEY, preference)
  applyTheme(preference)
}

export function applyTheme(preference: ThemePreference = getThemePreference()) {
  if (typeof document === 'undefined') return
  const dark =
    preference === 'dark' ||
    (preference === 'system' &&
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

// Keeps a `system` preference in sync when the OS theme flips mid-session.
export function watchSystemTheme(): () => void {
  if (typeof matchMedia !== 'function') return () => undefined
  const media = matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    if (getThemePreference() === 'system') applyTheme('system')
  }
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

// Components that theme a third-party surface need the resolved mode as a
// value, not just the `.dark` class. Watching the class keeps
// them right for `system` flips and manual switches alike.
export function useIsDarkTheme(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof document === 'undefined') return () => undefined
      const observer = new MutationObserver(onChange)
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      })
      return () => observer.disconnect()
    },
    () => (typeof document === 'undefined' ? false : document.documentElement.classList.contains('dark')),
    () => false,
  )
}

// Inlined into <head> so `.dark` lands before first paint — without it a dark
// user gets a light flash on every load.
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});if(t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`
