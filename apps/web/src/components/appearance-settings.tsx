import { useEffect, useState } from 'react'
import { cn } from '#/lib/utils'
import {
  getThemePreference,
  setThemePreference,
  THEMES,
  type ThemePreference,
} from '#/lib/theme'
import {
  DEFAULT_UI_SCALE,
  getUiScale,
  setUiScale,
  UI_SCALES,
  type UiScale,
} from '#/lib/ui-scale'

type ThemeOption = {
  value: ThemePreference
  label: string
  swatch: { canvas: string; surface: string; accent: string }
}

/** System first, then every concrete palette in `THEMES`. */
const THEME_OPTIONS: ThemeOption[] = [
  {
    value: 'system',
    label: 'System',
    swatch: {
      canvas: 'linear-gradient(90deg,#f4f4f5 0 50%,#191918 50%)',
      surface: 'linear-gradient(90deg,#ffffff 0 50%,#2a2926 50%)',
      accent: 'linear-gradient(90deg,#3f3f46 0 50%,#8fa8f8 50%)',
    },
  },
  ...THEMES.map((theme) => ({
    value: theme.id as ThemePreference,
    label: theme.label,
    swatch: theme.swatch,
  })),
]

/** A miniature of the chrome: canvas, a panel on it, and an accent mark. */
function ThemeSwatch({ swatch }: { swatch: ThemeOption['swatch'] }) {
  return (
    <span
      aria-hidden="true"
      className="relative block h-9 w-full overflow-hidden rounded border border-border"
      style={{ background: swatch.canvas }}
    >
      <span
        className="absolute inset-x-1 bottom-1 flex h-4 items-center gap-1 rounded-sm px-1"
        style={{ background: swatch.surface }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: swatch.accent }} />
        <span className="h-1 flex-1 rounded-full opacity-40" style={{ background: swatch.accent }} />
      </span>
    </span>
  )
}

const SCALE_LABELS: Record<UiScale, string> = {
  0.9: 'Compact',
  1: 'Default',
  1.1: 'Large',
  1.25: 'Larger',
  1.5: 'Largest',
}

const optionClassName = (selected: boolean) =>
  cn(
    'flex min-w-0 flex-col items-center gap-1.5 rounded-md border px-2 py-2 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
    selected
      ? 'border-ring bg-secondary text-foreground'
      : 'border-border bg-background/60 text-muted-foreground hover:bg-accent hover:text-foreground',
  )

/**
 * Theme and interface scale. Shared by the Appearance page and the Settings
 * dialog so the editor and the account pages cannot drift apart.
 *
 * Both preferences apply the moment they are picked — the whole app is the
 * preview, which beats a swatch for a choice about size.
 */
export function AppearanceSettings({ className }: { className?: string }) {
  const [theme, setTheme] = useState<ThemePreference>('light')
  const [scale, setScale] = useState<UiScale>(DEFAULT_UI_SCALE)

  useEffect(() => {
    setTheme(getThemePreference())
    setScale(getUiScale())
  }, [])

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <section className="flex flex-col gap-2">
        <div>
          <h2 className="text-sm font-semibold">Theme</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose how Loora’s workspace looks. System follows your device.
          </p>
        </div>
        <div
          className="grid grid-cols-2 gap-1 sm:grid-cols-3"
          role="group"
          aria-label="Color theme"
        >
          {THEME_OPTIONS.map((option) => {
            const selected = theme === option.value
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                className={optionClassName(selected)}
                onClick={() => {
                  setTheme(option.value)
                  setThemePreference(option.value)
                }}
              >
                <ThemeSwatch swatch={option.swatch} />
                <span className="truncate">{option.label}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div>
          <h2 className="text-sm font-semibold">Interface size</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Scales menus, panels, and text across the app. Your designs keep their own size —
            use the canvas zoom for those.
          </p>
        </div>
        <div className="grid grid-cols-5 gap-1" role="group" aria-label="Interface size">
          {UI_SCALES.map((option) => {
            const selected = scale === option
            return (
              <button
                key={option}
                type="button"
                aria-pressed={selected}
                className={optionClassName(selected)}
                onClick={() => {
                  setScale(option)
                  setUiScale(option)
                }}
              >
                {/* Sized in px so the sample keeps its meaning while the rest of
                    the app resizes around it. */}
                <span
                  aria-hidden="true"
                  className="flex h-8 w-full items-center justify-center rounded border border-border bg-surface font-semibold"
                  style={{ fontSize: `${Math.round(option * 11)}px` }}
                >
                  Aa
                </span>
                <span className="truncate">{Math.round(option * 100)}%</span>
                <span className="sr-only">{SCALE_LABELS[option]}</span>
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Currently {Math.round(scale * 100)}% · {SCALE_LABELS[scale]}
        </p>
      </section>
    </div>
  )
}
