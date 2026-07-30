import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  applyThemePreference,
  getThemePreference,
  setThemePreference,
  syncThemePreference,
  THEME_INIT_SCRIPT,
} from './theme'

const STORAGE_KEY = 'loora:theme'
const originalMatchMedia = window.matchMedia

function runInitScript() {
  Function('localStorage', 'document', THEME_INIT_SCRIPT)(
    window.localStorage,
    document,
  )
}

beforeEach(() => {
  window.localStorage.removeItem(STORAGE_KEY)
  document.documentElement.classList.remove('dark')
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  window.localStorage.removeItem(STORAGE_KEY)
  document.documentElement.classList.remove('dark')
  document.documentElement.removeAttribute('data-theme')
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
