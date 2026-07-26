import type { ReactNode } from 'react'
import { XIcon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import { ScrollArea } from '#/components/ui/scroll-area'
import { Skeleton } from '#/components/ui/skeleton'
import { cn } from '#/lib/utils'

export function PanelShell({
  title,
  description,
  onClose,
  actions,
  children,
  bodyClassName,
  className,
  /** Native overflow when the body hosts a filling child. */
  bodyScroll = true,
}: {
  title: string
  description?: ReactNode
  onClose?: () => void
  actions?: ReactNode
  children: ReactNode
  bodyClassName?: string
  className?: string
  bodyScroll?: boolean
}) {
  return (
    <aside className={cn('flex h-full min-h-0 w-full flex-col bg-card', className)}>
      <header className="flex items-start justify-between gap-2 border-b px-3 py-2.5">
        <div className="min-w-0">
          <h2 className="font-heading text-sm font-semibold">{title}</h2>
          {description ? (
            <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {description}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {onClose ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Close ${title}`}
              onClick={onClose}
            >
              <XIcon data-slot="icon" />
            </Button>
          ) : null}
        </div>
      </header>
      {bodyScroll ? (
        <div className="min-h-0 flex-1">
          <ScrollArea className="h-full" scrollFade>
            <div className={cn('flex flex-col', bodyClassName)}>{children}</div>
          </ScrollArea>
        </div>
      ) : (
        <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', bodyClassName)}>
          {children}
        </div>
      )}
    </aside>
  )
}

export function PanelEmpty({
  title,
  description,
  action,
  children,
  className,
  onClick,
}: {
  title?: string
  description?: ReactNode
  action?: ReactNode
  /** @deprecated Prefer title + description for hierarchy. */
  children?: ReactNode
  className?: string
  onClick?: () => void
}) {
  const classes = cn(
    'flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center',
    onClick && 'cursor-pointer rounded-lg border border-dashed hover:bg-secondary/60',
    className,
  )

  const body = (
    <>
      {title ? <p className="font-heading text-sm font-semibold text-foreground">{title}</p> : null}
      {description ? (
        <p className="max-w-[16rem] text-xs leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      {children && !title && !description ? (
        <div className="text-xs text-muted-foreground">{children}</div>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </>
  )

  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick}>
        {body}
      </button>
    )
  }
  return <div className={classes}>{body}</div>
}

export function PanelLoading({
  label,
  rows = 3,
}: {
  label: string
  rows?: number
}) {
  return (
    <div className="flex flex-col gap-2 p-3" aria-busy="true" aria-label={label}>
      <p className="cx-shimmer text-xs">{label}</p>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-8 w-full" />
      ))}
    </div>
  )
}
