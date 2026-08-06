import { useRef, useState, type ReactNode } from 'react'
import { ChevronDownIcon, ChevronRightIcon } from '@loora/ui/icons'
import { cn } from '@loora/ui/utils'

const control =
  'h-7 w-full min-w-0 rounded-md border bg-background text-xs outline-none focus-within:border-ring'
const MIXED = 'Mixed'

function round(value: number, places = 2) {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

export function Section({
  title,
  children,
  defaultOpen = true,
  action,
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  action?: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b px-2 py-1.5">
      <div className="flex h-6 items-center gap-1">
        <button
          type="button"
          className="flex h-6 flex-1 items-center gap-1 rounded px-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setOpen((current) => !current)}
        >
          {open ? <ChevronDownIcon className="size-3" /> : <ChevronRightIcon className="size-3" />}
          {title}
        </button>
        {open ? action : null}
      </div>
      {open ? <div className="mt-1 space-y-1">{children}</div> : null}
    </section>
  )
}

export function Pair({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-1">{children}</div>
}

export function NumberCell({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  disabled = false,
  onCommit,
}: {
  label: string
  value: number | null
  min?: number
  max?: number
  step?: number
  suffix?: string
  disabled?: boolean
  onCommit: (value: number) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const clamp = (next: number) =>
    Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? -Number.POSITIVE_INFINITY, next))
  const scrub = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (disabled || value === null) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const start = value
    let latest = start
    const onMove = (moveEvent: PointerEvent) => {
      latest = round(clamp(start + (moveEvent.clientX - startX) * step * (moveEvent.shiftKey ? 10 : 1)))
      if (inputRef.current) inputRef.current.value = String(latest)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (latest !== start) onCommit(latest)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  return (
    <label className={cn(control, 'flex items-center gap-1 ps-2', disabled && 'opacity-50')}>
      <span
        className={cn('shrink-0 select-none text-muted-foreground', !disabled && value !== null && 'cursor-ew-resize')}
        onPointerDown={scrub}
      >
        {label}
      </span>
      <input
        ref={inputRef}
        key={value ?? MIXED}
        type="number"
        inputMode="decimal"
        aria-label={label}
        defaultValue={value === null ? '' : round(value)}
        placeholder={value === null ? MIXED : undefined}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className="h-full w-full min-w-0 bg-transparent text-right tabular-nums outline-none"
        onBlur={(event) => {
          const next = Number(event.currentTarget.value)
          if (event.currentTarget.value !== '' && Number.isFinite(next) && next !== value) onCommit(clamp(next))
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      {suffix ? <span className="shrink-0 pe-2 text-muted-foreground/70">{suffix}</span> : <span className="pe-2" />}
    </label>
  )
}

export function SelectCell({
  label,
  value,
  children,
  disabled = false,
  onChange,
}: {
  label: string
  value: string | null
  children: ReactNode
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className={cn(control, 'flex items-center gap-1 ps-2', disabled && 'opacity-50')}>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <select
        aria-label={label}
        value={value ?? ''}
        disabled={disabled}
        className="h-full w-full min-w-0 bg-transparent pe-1 text-right outline-none"
        onChange={(event) => onChange(event.target.value)}
      >
        {value === null ? <option value="">{MIXED}</option> : null}
        {children}
      </select>
    </label>
  )
}
