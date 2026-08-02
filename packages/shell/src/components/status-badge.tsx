import { useEffect, useState } from 'react'
import { isDesktop } from '@loora/platform'
import { cn } from '@loora/ui/utils'

/**
 * The public status page. Instatus serves `summary.json` with
 * `access-control-allow-origin: *`, so the browser reads it directly — no
 * proxy route, and nothing to keep running when the app itself is down.
 */
const STATUS_URL = 'https://loora.instatus.com'
const SUMMARY_URL = `${STATUS_URL}/summary.json`
const REFRESH_MS = 60_000

type PageStatus = 'UP' | 'HASISSUES' | 'UNDERMAINTENANCE'

interface Summary {
  page?: { status?: string }
  activeIncidents?: { name?: string }[]
  activeMaintenances?: { name?: string }[]
}

const tones = {
  UP: { label: 'All systems normal', dot: 'bg-success' },
  HASISSUES: { label: 'Degraded', dot: 'bg-destructive' },
  UNDERMAINTENANCE: { label: 'Maintenance', dot: 'bg-warning' },
} satisfies Record<PageStatus, { label: string; dot: string }>

function readStatus(value: unknown): PageStatus | null {
  return typeof value === 'string' && value in tones ? (value as PageStatus) : null
}

/**
 * Sidebar footer badge. Absent from the desktop app: a status page is a
 * browser errand, and the window has no place to put a page it cannot render.
 */
export function StatusBadge({ className }: { className?: string }) {
  const [status, setStatus] = useState<PageStatus | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const desktop = isDesktop()

  useEffect(() => {
    if (desktop) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined

    const load = async () => {
      try {
        const response = await fetch(SUMMARY_URL, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        })
        if (!response.ok) throw new Error(`status ${response.status}`)
        const summary = (await response.json()) as Summary
        const next = readStatus(summary.page?.status)
        setStatus(next)
        const active = [
          ...(summary.activeIncidents ?? []),
          ...(summary.activeMaintenances ?? []),
        ]
        setDetail(active.find((entry) => entry?.name)?.name ?? null)
      } catch {
        // A status page that cannot be reached is not itself news worth
        // showing; the badge simply stays as it was, or stays absent.
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void load(), REFRESH_MS)
    }

    void load()
    return () => {
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [desktop])

  if (desktop || !status) return null
  const tone = tones[status]
  const label = detail ?? tone.label

  return (
    <a
      href={STATUS_URL}
      target="_blank"
      rel="noreferrer"
      title={detail ? `${tone.label} — ${detail}` : tone.label}
      className={cn(
        'flex items-center gap-1.5 rounded-sm px-2 py-1 text-2xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        className,
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', tone.dot)} />
      <span className="min-w-0 truncate">{label}</span>
    </a>
  )
}
