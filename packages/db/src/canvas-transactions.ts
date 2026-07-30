export const CANVAS_TRANSACTION_RETENTION = 500
export const CANVAS_TRANSACTION_PRUNE_INTERVAL = 50

export function canvasTransactionPruneBefore(
  previousRevision: number,
  nextRevision: number,
) {
  if (nextRevision <= CANVAS_TRANSACTION_RETENTION) return null
  const previousWindow = Math.floor(
    previousRevision / CANVAS_TRANSACTION_PRUNE_INTERVAL,
  )
  const nextWindow = Math.floor(
    nextRevision / CANVAS_TRANSACTION_PRUNE_INTERVAL,
  )
  if (previousWindow === nextWindow) return null
  return Math.max(0, nextRevision - CANVAS_TRANSACTION_RETENTION)
}
