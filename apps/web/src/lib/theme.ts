import { useSyncExternalStore } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'loora:theme'

// `localStorage` is not a bare global everywhere this module loads (SSR, tests),
// and Safari throws on access when storage is blocked. Both read and write go
// through here so neither path can crash a render.
function themeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? globalThis.window?.localStorage ?? null
  } catch {
    return null
  }
}

// Loora is dark-first: an unset preference means dark, not system. `system` is
// still selectable, so it has to be stored explicitly rather than as "absent".
export function getThemePreference(): ThemePreference {
  const raw = themeStorage()?.getItem(STORAGE_KEY)
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'dark'
}

export function setThemePreference(preference: ThemePreference) {
  themeStorage()?.setItem(STORAGE_KEY, preference)
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
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});if(t!=='light'&&(t!=='system'||matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`
