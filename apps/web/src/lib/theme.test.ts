import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { enforceLightTheme, THEME_INIT_SCRIPT } from './theme'

const STORAGE_KEY = 'loora:theme'

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
})

describe('light theme enforcement', () => {
  test('clears an old preference and removes the dark class', () => {
    window.localStorage.setItem(STORAGE_KEY, 'dark')
    document.documentElement.classList.add('dark')

    enforceLightTheme()

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  test('enforces light mode before first paint', () => {
    window.localStorage.setItem(STORAGE_KEY, 'system')
    document.documentElement.classList.add('dark')

    runInitScript()

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
