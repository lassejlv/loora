import { useCallback, useEffect, useState } from 'react'
import { authClient } from '@loora/auth/client'
import { RefreshCwIcon } from '@loora/ui/icons'
import { Button } from '@loora/ui/button'
import { AdminDesigns } from '../admin/designs'
import { AdminFlags } from '../admin/flags'
import { AdminLaunchWeek } from '../admin/launch-week'
import { AdminStats } from '../admin/stats'
import { AdminUsers } from '../admin/users'
import { orpc } from '@loora/rpc/client'
import type { AdminOverview } from '../admin/types'

/**
 * The whole panel is admin-only on the server (every `admin.*` procedure runs
 * behind `adminProcedure`). The client check here only decides what to render;
 * it is not the access control.
 */
export function AdminPanel() {
  const { data: session, isPending } = authClient.useSession()
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const userId = session?.user?.id
  const isAdmin = session?.user?.isAdmin === true

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await orpc.admin.overview())
      setError('')
    } catch {
      setError('Could not load the admin overview.')
    }
  }, [])

  useEffect(() => {
    if (isAdmin) void loadOverview()
  }, [isAdmin, loadOverview])

  if (isPending) {
    return <p className="text-xs text-muted-foreground">Checking access…</p>
  }

  if (!isAdmin || !userId) {
    return (
      <div className="rounded-md border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold">Admin only</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          This page is for Loora staff accounts.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {overview
            ? `Snapshot ${new Date(overview.generatedAt).toLocaleTimeString()}`
            : 'Loading snapshot…'}
        </p>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Refresh admin overview"
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true)
            await loadOverview()
            setRefreshing(false)
          }}
        >
          <RefreshCwIcon className={refreshing ? 'animate-spin' : ''} />
        </Button>
      </div>

      {error ? <p className="text-xs text-destructive-foreground">{error}</p> : null}
      {overview ? <AdminStats overview={overview} /> : null}

      <AdminLaunchWeek />

      <AdminUsers
        currentUserId={userId}
        pendingRequests={overview?.users.pendingPreviewRequests ?? 0}
        onChanged={() => void loadOverview()}
        limit={25}
      />

      <AdminDesigns onChanged={() => void loadOverview()} />

      <AdminFlags onChanged={() => void loadOverview()} />
    </div>
  )
}
