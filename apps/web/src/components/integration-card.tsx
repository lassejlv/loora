import type { ReactNode } from 'react'
import { cn } from '#/lib/utils'

export function IntegrationCard({
  title,
  status,
  description,
  children,
  className,
}: {
  title: string
  status?: ReactNode
  description?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border border-border sm:flex-row',
        className,
      )}
    >
      <aside className="flex shrink-0 flex-row items-center justify-between gap-3 border-b border-border bg-muted/40 px-3 py-3 sm:w-32 sm:flex-col sm:items-stretch sm:justify-between sm:border-b-0 sm:border-r sm:py-4">
        <h3 className="text-sm font-semibold leading-snug">{title}</h3>
        {status ? <div className="sm:mt-auto">{status}</div> : null}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        {description ? (
          <div className="text-xs leading-relaxed text-muted-foreground">{description}</div>
        ) : null}
        {children}
      </div>
    </section>
  )
}

export function IntegrationStatus({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning'
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        tone === 'success' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
        tone === 'warning' && 'bg-amber-500/10 text-amber-800 dark:text-amber-300',
        tone === 'neutral' && 'bg-background text-muted-foreground ring-1 ring-border',
      )}
    >
      {children}
    </span>
  )
}
