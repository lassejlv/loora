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
})

afterEach(() => {
  window.localStorage.removeItem(STORAGE_KEY)
  document.documentElement.classList.remove('dark')
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
