import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  DARK_PRESET,
  makeCustomTheme,
  saveCustomTheme,
} from './custom-themes'
import {
  applyThemePreference,
  getThemePreference,
  setThemePreference,
  syncThemePreference,
  THEME_INIT_SCRIPT,
} from './theme'

const STORAGE_KEY = 'loora:theme'
const CUSTOM_STORAGE_KEY = 'loora:custom-themes'
const originalMatchMedia = window.matchMedia

function runInitScript() {
  Function('localStorage', 'document', THEME_INIT_SCRIPT)(
    window.localStorage,
    document,
  )
}

beforeEach(() => {
  window.localStorage.removeItem(STORAGE_KEY)
  window.localStorage.removeItem(CUSTOM_STORAGE_KEY)
  document.documentElement.classList.remove('dark')
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('style')
})

afterEach(() => {
  window.localStorage.removeItem(STORAGE_KEY)
  window.localStorage.removeItem(CUSTOM_STORAGE_KEY)
  document.documentElement.classList.remove('dark')
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('style')
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: originalMatchMedia,
  })
})

describe('theme preferences', () => {
  test('uses light mode when no preference has been stored', () => {
    expect(getThemePreference()).toBe('light')

    applyThemePreference()

    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  test('stores and applies dark mode', () => {
    setThemePreference('dark')

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  test('restores a dark preference before first paint', () => {
    window.localStorage.setItem(STORAGE_KEY, 'dark')

    runInitScript()

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  test('restores light mode before first paint', () => {
    window.localStorage.setItem(STORAGE_KEY, 'light')
    document.documentElement.classList.add('dark')

    runInitScript()

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  test('marks a named theme with the attribute and keeps the dark class', () => {
    setThemePreference('tokyo-night')

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('tokyo-night')
    expect(document.documentElement.getAttribute('data-theme')).toBe('tokyo-night')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  test('clears the attribute when returning to a built-in theme', () => {
    setThemePreference('dracula')
    setThemePreference('light')

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  test('restores a named theme before first paint', () => {
    window.localStorage.setItem(STORAGE_KEY, 'github-dark')

    runInitScript()

    expect(document.documentElement.getAttribute('data-theme')).toBe('github-dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  test('ignores a theme it does not know', () => {
    window.localStorage.setItem(STORAGE_KEY, 'solarized')

    expect(getThemePreference()).toBe('light')

    runInitScript()

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  test('applies a custom theme inline and clears it again', () => {
    const theme = saveCustomTheme(
      makeCustomTheme({ name: 'Mine', dark: true, colors: { ...DARK_PRESET, canvas: '#101014' } }),
    )[0]!

    setThemePreference(theme.id)

    const root = document.documentElement
    expect(root.getAttribute('data-theme')).toBe('custom')
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.style.getPropertyValue('--cx-canvas')).toBe('#101014')

    setThemePreference('light')

    expect(root.hasAttribute('data-theme')).toBe(false)
    expect(root.style.getPropertyValue('--cx-canvas')).toBe('')
  })

  test('restores a custom theme before first paint', () => {
    const theme = saveCustomTheme(
      makeCustomTheme({ name: 'Mine', dark: true, colors: { ...DARK_PRESET, canvas: '#0b0b0f' } }),
    )[0]!
    window.localStorage.setItem(STORAGE_KEY, theme.id)

    runInitScript()

    expect(document.documentElement.getAttribute('data-theme')).toBe('custom')
    expect(document.documentElement.style.getPropertyValue('--cx-canvas')).toBe('#0b0b0f')
  })

  test('falls back when the selected custom theme is gone', () => {
    window.localStorage.setItem(STORAGE_KEY, 'custom:missing')

    expect(getThemePreference()).toBe('light')

    applyThemePreference()

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  test('tracks system appearance changes while system mode is selected', () => {
    let dark = true
    let listener: (() => void) | undefined
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        get matches() {
          return dark
        },
        addEventListener: (_event: string, next: () => void) => {
          listener = next
        },
        removeEventListener: () => {},
      }),
    })

    setThemePreference('system')
    const stop = syncThemePreference()
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    dark = false
    listener?.()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    stop()
  })
})
