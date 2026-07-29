import type { ReactNode } from 'react'
import { cn } from '#/lib/utils'

/** Flat integration section — used under the Integrations top nav, not as stacked cards. */
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
    <section className={cn('flex flex-col gap-3', className)}>
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xs font-semibold leading-none">{title}</h3>
          {status}
        </div>
        {description ? (
          <div className="text-xs leading-relaxed text-muted-foreground">{description}</div>
        ) : null}
      </header>
      {children ? <div className="flex flex-col gap-2.5">{children}</div> : null}
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
        'inline-flex max-w-full items-center rounded-sm border border-current/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide',
        tone === 'success' && 'bg-success/10 text-success-foreground',
        tone === 'warning' && 'bg-warning/10 text-warning-foreground',
        tone === 'neutral' && 'bg-muted text-muted-foreground',
      )}
    >
      {children}
    </span>
  )
}
