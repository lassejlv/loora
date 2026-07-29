const STORAGE_KEY = 'loora:theme'

export function enforceLightTheme() {
  try {
    const storage =
      globalThis.localStorage ?? globalThis.window?.localStorage ?? null
    storage?.removeItem(STORAGE_KEY)
  } catch {
    // Storage can be unavailable in private browsing or blocked contexts.
  }
  if (typeof document !== 'undefined') {
    document.documentElement.classList.remove('dark')
    if (document.documentElement.getAttribute('class') === '') {
      document.documentElement.removeAttribute('class')
    }
  }
}

// Runs before first paint so an old saved preference cannot flash dark.
export const THEME_INIT_SCRIPT = `try{localStorage.removeItem(${JSON.stringify(STORAGE_KEY)})}catch(e){}document.documentElement.classList.remove('dark');if(document.documentElement.getAttribute('class')==='')document.documentElement.removeAttribute('class')`
