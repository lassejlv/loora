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

export function SettingsPanel() {
  const { data: session } = authClient.useSession()

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-6">
      <Tabs defaultValue="account" className="flex max-w-md flex-col gap-6">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTab value="account">Account</TabsTab>
          <TabsTab value="usage">Usage</TabsTab>
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
      </Tabs>
    </div>
  )
}
