import { useEffect, useState } from 'react'
import { LogOutIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Tabs, TabsList, TabsPanel, TabsTab } from '#/components/ui/tabs'
import {
  Progress,
  ProgressIndicator,
  ProgressLabel,
  ProgressTrack,
  ProgressValue,
} from '#/components/ui/progress'
import { authClient } from '#/lib/auth-client'
import { orpc } from '#/lib/orpc-client'

interface UsageStatus {
  dailyUsd: number
  weeklyUsd: number
  dailyLimitUsd: number
  weeklyLimitUsd: number
}

interface AdminUserUsage {
  id: string
  name: string
  email: string
  isAdmin: boolean
  dailyUsd: number
  weeklyUsd: number
}

function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const leftPct = Math.max(0, Math.round((1 - used / limit) * 100))
  return (
    <Progress value={leftPct} className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <ProgressLabel className="text-xs font-medium">{label}</ProgressLabel>
        <ProgressValue className="font-mono text-xs text-muted-foreground">
          {() => `${leftPct}% left`}
        </ProgressValue>
      </div>
      <ProgressTrack className="h-2">
        <ProgressIndicator />
      </ProgressTrack>
      <p className="text-[11px] text-muted-foreground">
        Resets on a rolling window as older usage ages out.
      </p>
    </Progress>
  )
}

function UsageTab() {
  const [usage, setUsage] = useState<UsageStatus | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    orpc.usage
      .get()
      .then((data) => {
        if (!cancelled) setUsage(data)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return <p className="text-xs text-destructive-foreground">Could not load usage.</p>
  }
  if (!usage) {
    return <p className="cx-shimmer text-xs">Loading usage…</p>
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-sm font-semibold">AI usage</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Each request counts toward a daily (24h) and weekly (7d) allowance.
        </p>
      </div>
      <UsageMeter label="Daily" used={usage.dailyUsd} limit={usage.dailyLimitUsd} />
      <UsageMeter label="Weekly" used={usage.weeklyUsd} limit={usage.weeklyLimitUsd} />
    </div>
  )
}

function AdminTab() {
  const [users, setUsers] = useState<AdminUserUsage[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resetting, setResetting] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    orpc.admin
      .listUsers()
      .then((data) => {
        if (!cancelled) setUsers(data)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load users.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleReset(account: AdminUserUsage) {
    if (!window.confirm(`Reset all AI usage for ${account.email}?`)) return

    setResetting(account.id)
    setError(null)
    try {
      await orpc.admin.resetUsage({ userId: account.id })
      setUsers((current) =>
        current?.map((user) =>
          user.id === account.id ? { ...user, dailyUsd: 0, weeklyUsd: 0 } : user,
        ) ?? null,
      )
    } catch {
      setError(`Could not reset usage for ${account.email}.`)
    } finally {
      setResetting(null)
    }
  }

  if (!users && !error) {
    return <p className="cx-shimmer text-xs">Loading users…</p>
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold">Admin</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Reset a user&apos;s daily and weekly AI usage.
        </p>
      </div>
      {error ? <p className="text-xs text-destructive-foreground">{error}</p> : null}
      <div className="divide-y divide-border rounded-lg border border-border">
        {users?.map((account) => (
          <div
            key={account.id}
            className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {account.name}
                {account.isAdmin ? (
                  <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-cx-accent">
                    Admin
                  </span>
                ) : null}
              </p>
              <p className="truncate text-xs text-muted-foreground">{account.email}</p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                ${account.dailyUsd.toFixed(4)} today · ${account.weeklyUsd.toFixed(4)} this week
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={resetting === account.id}
              onClick={() => handleReset(account)}
            >
              {resetting === account.id ? 'Resetting…' : 'Reset usage'}
            </Button>
          </div>
        ))}
        {users?.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">No users found.</p>
        ) : null}
      </div>
    </div>
  )
}

export function SettingsPanel() {
  const { data: session } = authClient.useSession()
  const isAdmin = session?.user.isAdmin === true

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-6">
      <Tabs defaultValue="account" className="flex max-w-md flex-col gap-6">
        <TabsList className={`grid w-full ${isAdmin ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <TabsTab value="account">Account</TabsTab>
          <TabsTab value="usage">Usage</TabsTab>
          {isAdmin ? <TabsTab value="admin">Admin</TabsTab> : null}
        </TabsList>

        <TabsPanel value="account" className="flex flex-col gap-6">
          <div>
            <h2 className="text-sm font-semibold">Account</h2>
            <p className="mt-1 text-xs text-muted-foreground">Signed in to loora.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-cx-accent/10 text-sm font-semibold text-cx-accent">
              {(session?.user.name ?? session?.user.email ?? '?').slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{session?.user.name ?? '—'}</p>
              <p className="truncate text-xs text-muted-foreground">{session?.user.email}</p>
            </div>
          </div>
          <div>
            <Button variant="outline" size="sm" onClick={() => authClient.signOut()}>
              <LogOutIcon data-slot="icon" />
              Sign out
            </Button>
          </div>
        </TabsPanel>

        <TabsPanel value="usage">
          <UsageTab />
        </TabsPanel>

        {isAdmin ? (
          <TabsPanel value="admin">
            <AdminTab />
          </TabsPanel>
        ) : null}
      </Tabs>
    </div>
  )
}
