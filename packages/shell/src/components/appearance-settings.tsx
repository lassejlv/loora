import { useEffect, useState } from 'react'
import { PencilIcon, PlusIcon } from '@loora/ui/icons'
import { Button } from '@loora/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@loora/ui/dialog'
import { Input } from '@loora/ui/input'
import { cn } from '@loora/ui/utils'
import {
  DARK_PRESET,
  deleteCustomTheme,
  getCustomThemes,
  LIGHT_PRESET,
  makeCustomTheme,
  saveCustomTheme,
  type CustomTheme,
  type CustomThemeColors,
} from '#/lib/custom-themes'
import {
  BUILT_IN_THEMES,
  getThemePreference,
  setThemePreference,
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
  custom?: CustomTheme
}

const SYSTEM_OPTION: ThemeOption = {
  value: 'system',
  label: 'System',
  swatch: {
    canvas: 'linear-gradient(90deg,#f4f4f5 0 50%,#191918 50%)',
    surface: 'linear-gradient(90deg,#ffffff 0 50%,#2a2926 50%)',
    accent: 'linear-gradient(90deg,#3f3f46 0 50%,#8fa8f8 50%)',
  },
}

/** System, the built-in palettes, then whatever this browser has saved. */
function themeOptions(custom: CustomTheme[]): ThemeOption[] {
  return [
    SYSTEM_OPTION,
    ...BUILT_IN_THEMES.map((theme) => ({
      value: theme.id as ThemePreference,
      label: theme.label,
      swatch: theme.swatch,
    })),
    ...custom.map((theme) => ({
      value: theme.id as ThemePreference,
      label: theme.name,
      swatch: {
        canvas: theme.colors.canvas,
        surface: theme.colors.surface,
        accent: theme.colors.accent,
      },
      custom: theme,
    })),
  ]
}

const COLOR_FIELDS: { key: keyof CustomThemeColors; label: string; hint: string }[] = [
  { key: 'canvas', label: 'Canvas', hint: 'Behind the design and the app pages' },
  { key: 'surface', label: 'Surface', hint: 'Panels, menus, and bars' },
  { key: 'line', label: 'Line', hint: 'Hairlines and borders' },
  { key: 'ink', label: 'Text', hint: 'Foreground text and icons' },
  { key: 'accent', label: 'Accent', hint: 'Selection, focus, and primary buttons' },
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

/**
 * The custom-theme editor. Five colours and a base; everything else is derived
 * from them, so a saved theme cannot end up with an unreadable pairing between
 * tokens that are supposed to agree.
 */
function ThemeEditor({
  open,
  editing,
  onOpenChange,
  onSaved,
  onDeleted,
}: {
  open: boolean
  editing: CustomTheme | null
  onOpenChange: (open: boolean) => void
  onSaved: (theme: CustomTheme) => void
  onDeleted: (id: string) => void
}) {
  const [name, setName] = useState('')
  const [dark, setDark] = useState(true)
  const [colors, setColors] = useState<CustomThemeColors>(DARK_PRESET)

  // Reopening the dialog starts from the theme being edited, or a fresh preset.
  useEffect(() => {
    if (!open) return
    setName(editing?.name ?? '')
    setDark(editing?.dark ?? true)
    setColors(editing?.colors ?? DARK_PRESET)
  }, [open, editing])

  const setBase = (nextDark: boolean) => {
    setDark(nextDark)
    // Only a fresh theme adopts the preset; an edit keeps the picked colours.
    if (!editing) setColors(nextDark ? DARK_PRESET : LIGHT_PRESET)
  }

  const save = () => {
    const theme = makeCustomTheme({ id: editing?.id, name, dark, colors })
    saveCustomTheme(theme)
    onSaved(theme)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit theme' : 'New theme'}</DialogTitle>
          <DialogDescription>
            Saved in this browser only. Loora derives the rest of the palette — tints, inputs,
            and focus rings — from these five colours.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <Input
            autoFocus
            aria-label="Theme name"
            placeholder="Theme name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Base</span>
            <div
              role="group"
              aria-label="Base"
              className="flex items-center gap-0.5 rounded-sm border border-line p-0.5"
            >
              <Button
                size="xs"
                variant={dark ? 'secondary' : 'ghost'}
                aria-pressed={dark}
                onClick={() => setBase(true)}
              >
                Dark
              </Button>
              <Button
                size="xs"
                variant={dark ? 'ghost' : 'secondary'}
                aria-pressed={!dark}
                onClick={() => setBase(false)}
              >
                Light
              </Button>
            </div>
          </div>

          <div className="grid gap-2">
            {COLOR_FIELDS.map((field) => (
              <label key={field.key} className="flex items-center gap-2.5">
                <input
                  type="color"
                  aria-label={field.label}
                  value={colors[field.key]}
                  className="size-7 shrink-0 cursor-pointer rounded-sm border border-line bg-transparent p-0.5"
                  onChange={(event) =>
                    setColors((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">{field.label}</span>
                  <span className="block text-xs text-muted-foreground">{field.hint}</span>
                </span>
                <span className="shrink-0 font-mono text-xs uppercase text-muted-foreground">
                  {colors[field.key]}
                </span>
              </label>
            ))}
          </div>

          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">Preview</p>
            <ThemeSwatch
              swatch={{
                canvas: colors.canvas,
                surface: colors.surface,
                accent: colors.accent,
              }}
            />
          </div>
        </DialogPanel>
        <DialogFooter className="sm:justify-between">
          {editing ? (
            <Button
              variant="destructive-outline"
              onClick={() => {
                deleteCustomTheme(editing.id)
                onDeleted(editing.id)
                onOpenChange(false)
              }}
            >
              Delete
            </Button>
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={!name.trim()} onClick={save}>
              {editing ? 'Save theme' : 'Create theme'}
            </Button>
          </span>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
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

  const [custom, setCustom] = useState<CustomTheme[]>([])
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<CustomTheme | null>(null)

  useEffect(() => {
    setTheme(getThemePreference())
    setScale(getUiScale())
    setCustom(getCustomThemes())
  }, [])

  const options = themeOptions(custom)

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <section className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Theme</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose how Loora’s workspace looks. System follows your device; your own themes
              stay in this browser.
            </p>
          </div>
          <Button
            size="xs"
            variant="outline"
            className="shrink-0"
            onClick={() => {
              setEditing(null)
              setEditorOpen(true)
            }}
          >
            <PlusIcon />
            New theme
          </Button>
        </div>
        <div
          className="grid grid-cols-2 gap-1 sm:grid-cols-3"
          role="group"
          aria-label="Color theme"
        >
          {options.map((option) => {
            const selected = theme === option.value
            return (
              <div key={option.value} className="relative">
                <button
                  type="button"
                  aria-pressed={selected}
                  className={cn(optionClassName(selected), 'w-full')}
                  onClick={() => {
                    setTheme(option.value)
                    setThemePreference(option.value)
                  }}
                >
                  <ThemeSwatch swatch={option.swatch} />
                  <span className="truncate">{option.label}</span>
                </button>
                {option.custom ? (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Edit ${option.label}`}
                    className="absolute end-1 top-1 bg-surface"
                    onClick={() => {
                      setEditing(option.custom!)
                      setEditorOpen(true)
                    }}
                  >
                    <PencilIcon />
                  </Button>
                ) : null}
              </div>
            )
          })}
        </div>
      </section>

      <ThemeEditor
        open={editorOpen}
        editing={editing}
        onOpenChange={setEditorOpen}
        onSaved={(saved) => {
          setCustom(getCustomThemes())
          // Saving is also picking: the point of editing is to look at it.
          setTheme(saved.id)
          setThemePreference(saved.id)
        }}
        onDeleted={(id) => {
          setCustom(getCustomThemes())
          if (theme === id) {
            const fallback = 'dark'
            setTheme(fallback)
            setThemePreference(fallback)
          }
        }}
      />

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
