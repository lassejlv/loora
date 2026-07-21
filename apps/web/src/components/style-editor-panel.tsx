import { useEffect, useState } from 'react'
import { getStyleToken, setStyleToken, type StyleTokenKind } from '#/lib/style-edit'

// Floating style editor for a node right-clicked in an edit-mode frame.
// Every control swaps Tailwind class tokens and applies immediately —
// onApply(prev, next) receives the full class string before and after so the
// caller can exact-replace it in the element source. The panel chains its own
// `current` value so successive tweaks keep mapping onto the latest code.

// The loora palette plus neutrals; arbitrary-value classes so they work
// without any Tailwind config.
const COLORS = [
  ['#1a1917', 'Ink'],
  ['#ffffff', 'White'],
  ['#75726b', 'Gray'],
  ['#2440e6', 'Ultramarine'],
  ['#e8442e', 'Vermilion'],
  ['#f5c518', 'Yellow'],
  ['#23a25d', 'Green'],
] as const

const FONT_SIZES = ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl', 'text-3xl', 'text-4xl', 'text-5xl'] as const
const FONT_WEIGHTS = ['font-normal', 'font-medium', 'font-semibold', 'font-bold'] as const
const RADII = ['rounded-none', 'rounded-md', 'rounded-lg', 'rounded-xl', 'rounded-2xl', 'rounded-full'] as const

function ColorRow({
  label,
  active,
  onPick,
}: {
  label: string
  active: string | null
  onPick: (hex: string | null) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-9 shrink-0 text-[10px] text-muted-foreground">{label}</span>
      {COLORS.map(([hex, name]) => (
        <button
          key={hex}
          type="button"
          title={name}
          aria-pressed={active?.includes(hex) ?? false}
          className={
            'size-4.5 shrink-0 rounded-full border ' +
            (active?.includes(hex) ? 'ring-2 ring-cx-accent ring-offset-1' : 'hover:scale-110')
          }
          style={{ background: hex }}
          onClick={() => onPick(hex)}
        />
      ))}
      <button
        type="button"
        title="Remove"
        className="shrink-0 rounded px-1 text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground"
        onClick={() => onPick(null)}
      >
        ✕
      </button>
    </div>
  )
}

function TokenRow({
  label,
  options,
  active,
  short,
  onPick,
}: {
  label: string
  options: readonly string[]
  active: string | null
  short: (token: string) => string
  onPick: (token: string | null) => void
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-9 shrink-0 text-[10px] text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-0.5">
        {options.map((token) => (
          <button
            key={token}
            type="button"
            aria-pressed={active === token}
            className={
              'rounded px-1.5 py-0.5 text-[10px] ' +
              (active === token
                ? 'bg-cx-accent font-medium text-white'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground')
            }
            onClick={() => onPick(active === token ? null : token)}
          >
            {short(token)}
          </button>
        ))}
      </div>
    </div>
  )
}

export function StyleEditorPanel({
  tag,
  className,
  onApply,
  onClose,
}: {
  tag: string
  className: string
  onApply: (prev: string, next: string) => void
  onClose: () => void
}) {
  const [current, setCurrent] = useState(className)
  const [raw, setRaw] = useState(className)

  useEffect(() => {
    setCurrent(className)
    setRaw(className)
  }, [className])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const apply = (next: string) => {
    const trimmed = next.trim()
    if (trimmed === current) return
    onApply(current, trimmed)
    setCurrent(trimmed)
    setRaw(trimmed)
  }

  const setToken = (kind: StyleTokenKind, token: string | null) =>
    apply(setStyleToken(current, kind, token))

  return (
    <div
      className="absolute right-4 bottom-4 z-20 flex w-80 flex-col gap-2 rounded-xl border bg-card p-2.5 shadow-md"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
          &lt;{tag}&gt; styles
        </span>
        <button
          type="button"
          aria-label="Close style editor"
          className="rounded px-1.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <ColorRow
        label="Text"
        active={getStyleToken(current, 'textColor')}
        onPick={(hex) => setToken('textColor', hex ? `text-[${hex}]` : null)}
      />
      <ColorRow
        label="Fill"
        active={getStyleToken(current, 'bgColor')}
        onPick={(hex) => setToken('bgColor', hex ? `bg-[${hex}]` : null)}
      />
      <TokenRow
        label="Size"
        options={FONT_SIZES}
        active={getStyleToken(current, 'fontSize')}
        short={(t) => t.slice(5)}
        onPick={(t) => setToken('fontSize', t)}
      />
      <TokenRow
        label="Weight"
        options={FONT_WEIGHTS}
        active={getStyleToken(current, 'fontWeight')}
        short={(t) => t.slice(5)}
        onPick={(t) => setToken('fontWeight', t)}
      />
      <TokenRow
        label="Corner"
        options={RADII}
        active={getStyleToken(current, 'radius')}
        short={(t) => (t === 'rounded-none' ? 'none' : t.slice(8))}
        onPick={(t) => setToken('radius', t)}
      />
      <div className="flex items-center gap-1.5">
        <input
          value={raw}
          spellCheck={false}
          aria-label="Class list"
          className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 font-mono text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onChange={(e) => setRaw(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') apply(raw)
          }}
        />
        <button
          type="button"
          disabled={raw.trim() === current}
          className="rounded-md bg-cx-accent px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40"
          onClick={() => apply(raw)}
        >
          Apply
        </button>
      </div>
    </div>
  )
}
