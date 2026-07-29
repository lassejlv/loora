import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  THEME_INIT_SCRIPT,
  applyTheme,
  getThemePreference,
  setThemePreference,
} from './theme'

const STORAGE_KEY = 'loora:theme'

// The preload installs `window` but not `matchMedia`, which `applyTheme` reads
// off the global for a `system` preference.
const originalMatchMedia = globalThis.matchMedia

function stubMatchMedia(prefersDark: boolean) {
  globalThis.matchMedia = ((query: string) => ({
    matches: prefersDark && query.includes('dark'),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
  })) as unknown as typeof matchMedia
}

/** Runs the inlined <head> script the way `RootDocument` ships it. */
function runInitScript(prefersDark: boolean) {
  stubMatchMedia(prefersDark)
  document.documentElement.classList.remove('dark')
  Function('localStorage', 'matchMedia', 'document', THEME_INIT_SCRIPT)(
    window.localStorage,
    globalThis.matchMedia,
    document,
  )
  return document.documentElement.classList.contains('dark')
}

beforeEach(() => {
  window.localStorage.removeItem(STORAGE_KEY)
  document.documentElement.classList.remove('dark')
})

afterEach(() => {
  window.localStorage.removeItem(STORAGE_KEY)
  document.documentElement.classList.remove('dark')
  globalThis.matchMedia = originalMatchMedia
})

describe('theme preference', () => {
  test('defaults to dark when nothing is stored', () => {
    expect(getThemePreference()).toBe('dark')
  })

  test('treats an unrecognised stored value as dark', () => {
    window.localStorage.setItem(STORAGE_KEY, 'sepia')
    expect(getThemePreference()).toBe('dark')
  })

  // `system` used to be the absence of a value. Now that absence means dark, it
  // has to be written down or picking it would silently read back as dark.
  test('stores `system` explicitly so it survives a reload', () => {
    stubMatchMedia(false)
    setThemePreference('system')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('system')
    expect(getThemePreference()).toBe('system')
  })

  test('`system` follows the OS', () => {
    stubMatchMedia(true)
    applyTheme('system')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    stubMatchMedia(false)
    applyTheme('system')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})

// The inlined script and `getThemePreference` are two implementations of one
// rule. They drift silently — a mismatch only shows as a first-paint flash.
describe('THEME_INIT_SCRIPT', () => {
  test('paints dark with no stored preference, whatever the OS says', () => {
    expect(runInitScript(false)).toBe(true)
    expect(runInitScript(true)).toBe(true)
  })

  test('honours an explicit light preference', () => {
    window.localStorage.setItem(STORAGE_KEY, 'light')
    expect(runInitScript(true)).toBe(false)
  })

  test('honours an explicit dark preference', () => {
    window.localStorage.setItem(STORAGE_KEY, 'dark')
    expect(runInitScript(false)).toBe(true)
  })

  test('defers to the OS only for `system`', () => {
    window.localStorage.setItem(STORAGE_KEY, 'system')
    expect(runInitScript(false)).toBe(false)
    expect(runInitScript(true)).toBe(true)
  })
})
