import { afterEach, describe, expect, test } from 'vitest'
import {
  applyUiScale,
  DEFAULT_UI_SCALE,
  getUiScale,
  normalizeUiScale,
  setUiScale,
  UI_SCALE_INIT_SCRIPT,
} from './ui-scale'

const STORAGE_KEY = 'loora:ui-scale'

function runInitScript() {
  Function('localStorage', 'document', UI_SCALE_INIT_SCRIPT)(
    window.localStorage,
    document,
  )
}

afterEach(() => {
  window.localStorage.removeItem(STORAGE_KEY)
  document.documentElement.style.removeProperty('font-size')
})

describe('normalizeUiScale', () => {
  test('keeps offered steps and falls back for junk', () => {
    expect(normalizeUiScale(1.25)).toBe(1.25)
    expect(normalizeUiScale('1.1')).toBe(1.1)
    expect(normalizeUiScale('not a number')).toBe(DEFAULT_UI_SCALE)
    expect(normalizeUiScale(null)).toBe(DEFAULT_UI_SCALE)
  })

  test('snaps in-between and out-of-range values onto a step', () => {
    expect(normalizeUiScale(1.2)).toBe(1.25)
    expect(normalizeUiScale(0.2)).toBe(0.9)
    expect(normalizeUiScale(9)).toBe(1.5)
  })
})

describe('getUiScale', () => {
  test('defaults when nothing is stored', () => {
    expect(getUiScale()).toBe(DEFAULT_UI_SCALE)
  })

  test('reads a stored step', () => {
    window.localStorage.setItem(STORAGE_KEY, '1.5')
    expect(getUiScale()).toBe(1.5)
  })
})

describe('applyUiScale', () => {
  test('sets the root font size as a percentage', () => {
    applyUiScale(1.25)
    expect(document.documentElement.style.fontSize).toBe('125%')
  })

  test('leaves the root alone at the default so browser preferences win', () => {
    applyUiScale(1.25)
    applyUiScale(DEFAULT_UI_SCALE)
    expect(document.documentElement.style.fontSize).toBe('')
  })
})

describe('setUiScale', () => {
  test('persists and applies in one step', () => {
    setUiScale(1.1)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1.1')
    expect(document.documentElement.style.fontSize).toBe('110%')
    expect(getUiScale()).toBe(1.1)
  })
})

describe('UI_SCALE_INIT_SCRIPT', () => {
  test('applies a stored scale before paint', () => {
    window.localStorage.setItem(STORAGE_KEY, '1.5')
    runInitScript()
    expect(document.documentElement.style.fontSize).toBe('150%')
  })

  test('does nothing for the default or for junk', () => {
    runInitScript()
    expect(document.documentElement.style.fontSize).toBe('')
    window.localStorage.setItem(STORAGE_KEY, 'huge')
    runInitScript()
    expect(document.documentElement.style.fontSize).toBe('')
  })

  test('clamps a hand-edited value to the offered range', () => {
    window.localStorage.setItem(STORAGE_KEY, '12')
    runInitScript()
    expect(document.documentElement.style.fontSize).toBe('150%')
  })
})
