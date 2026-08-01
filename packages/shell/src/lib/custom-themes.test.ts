import { afterEach, describe, expect, test } from 'bun:test'
import {
  CUSTOM_THEME_VAR_NAMES,
  DARK_PRESET,
  deleteCustomTheme,
  deriveThemeVars,
  getCustomTheme,
  getCustomThemes,
  isCustomThemeId,
  LIGHT_PRESET,
  makeCustomTheme,
  saveCustomTheme,
} from './custom-themes'

const STORAGE_KEY = 'loora:custom-themes'

afterEach(() => {
  window.localStorage.removeItem(STORAGE_KEY)
})

describe('deriveThemeVars', () => {
  test('maps the picked colours onto the tokens the app reads', () => {
    const vars = deriveThemeVars(DARK_PRESET, true)

    expect(vars['--cx-canvas']).toBe(DARK_PRESET.canvas)
    expect(vars['--surface']).toBe(DARK_PRESET.surface)
    expect(vars['--line']).toBe(DARK_PRESET.line)
    expect(vars['--foreground']).toBe(DARK_PRESET.ink)
    expect(vars['--ring']).toBe(DARK_PRESET.accent)
    // Semantic colours stay with the base block so an error cannot go green.
    expect(vars).not.toHaveProperty('--destructive')
    expect(vars).not.toHaveProperty('--success')
  })

  test('every derived name is in the clear-on-switch list', () => {
    for (const name of Object.keys(deriveThemeVars(LIGHT_PRESET, false))) {
      expect(CUSTOM_THEME_VAR_NAMES).toContain(name)
    }
  })
})

describe('makeCustomTheme', () => {
  test('mints a prefixed id and keeps the colours', () => {
    const theme = makeCustomTheme({ name: 'Mine', dark: true, colors: DARK_PRESET })

    expect(isCustomThemeId(theme.id)).toBe(true)
    expect(theme.name).toBe('Mine')
    expect(theme.colors).toEqual(DARK_PRESET)
    expect(theme.vars['--cx-accent']).toBe(DARK_PRESET.accent)
  })

  test('falls back to the preset for a colour that is not a hex value', () => {
    const theme = makeCustomTheme({
      name: '',
      dark: false,
      colors: { ...LIGHT_PRESET, accent: 'url(javascript:alert(1))' },
    })

    expect(theme.colors.accent).toBe(LIGHT_PRESET.accent)
    expect(theme.name).toBe('Custom')
  })
})

describe('the stored list', () => {
  test('saves, replaces in place, and deletes', () => {
    const first = saveCustomTheme(makeCustomTheme({ name: 'One', dark: true, colors: DARK_PRESET }))
    const second = saveCustomTheme(
      makeCustomTheme({ name: 'Two', dark: false, colors: LIGHT_PRESET }),
    )
    expect(second.map((theme) => theme.name)).toEqual(['One', 'Two'])

    const renamed = { ...first[0]!, name: 'Renamed' }
    const after = saveCustomTheme(renamed)
    expect(after.map((theme) => theme.name)).toEqual(['Renamed', 'Two'])
    expect(getCustomTheme(renamed.id)?.name).toBe('Renamed')

    expect(deleteCustomTheme(renamed.id).map((theme) => theme.name)).toEqual(['Two'])
  })

  test('survives junk in storage', () => {
    window.localStorage.setItem(STORAGE_KEY, 'not json')
    expect(getCustomThemes()).toEqual([])

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: 'nope', name: 'Bad' }, null, 42]),
    )
    expect(getCustomThemes()).toEqual([])
  })

  test('re-derives properties on read instead of trusting stored ones', () => {
    const theme = makeCustomTheme({ name: 'Mine', dark: true, colors: DARK_PRESET })
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ ...theme, vars: { '--surface': 'red', 'background': 'url(x)' } }]),
    )

    const [stored] = getCustomThemes()
    expect(stored?.vars['--surface']).toBe(DARK_PRESET.surface)
    expect(stored?.vars).not.toHaveProperty('background')
  })
})
