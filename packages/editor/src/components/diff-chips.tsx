import { cn } from '@loora/ui/utils'

/**
 * Added / removed / edited counts, in the diff colours the rest of the editor
 * uses. Shared by version history and branch review so a "what changed" number
 * reads the same wherever it appears.
 */
export function DiffChips({
  added,
  removed,
  changed,
  className,
  emptyLabel = 'No changes',
}: {
  added: number
  removed: number
  changed: number
  className?: string
  emptyLabel?: string
}) {
  if (added + removed + changed === 0) {
    return <span className={cn('text-xs text-muted-foreground', className)}>{emptyLabel}</span>
  }
  return (
    <span className={cn('flex items-center gap-1.5 text-xs tabular-nums', className)}>
      {added > 0 ? <span className="text-diff-added">+{added}</span> : null}
      {removed > 0 ? <span className="text-diff-removed">−{removed}</span> : null}
      {changed > 0 ? <span className="text-muted-foreground">~{changed}</span> : null}
    </span>
  )
}
