import { useEffect, useState } from 'react'
import { LogOutIcon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Tabs, TabsList, TabsPanel, TabsTab } from '#/components/ui/tabs'
import {
  Progress,
  ProgressIndicator,
  ProgressLabel,
  ProgressTrack,
  ProgressValue,
} from '#/components/ui/progress'
import { authClient } from '@loora/auth/client'
import { orpc } from '#/lib/orpc-client'
import { ChatGPTAccount } from '#/components/chatgpt-account'
import { CreditTopUp } from '#/components/credit-top-up'
import { GitHubAccount } from '#/components/github-account'

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
  previewAccess: boolean
  previewAccessRequestedAt: Date | null
  usageMultiplier: number
  dailyUsd: number
  weeklyUsd: number
  dailyLimitUsd: number
  weeklyLimitUsd: number
}

const MULTIPLIER_PRESETS = [1, 5, 10, 20] as const

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

function BillingTab({ isAdmin }: { isAdmin: boolean }) {
  const [billing, setBilling] = useState<Awaited<ReturnType<typeof orpc.billing.status>> | null>(null)
  const [error, setError] = useState('')
  const [openingPortal, setOpeningPortal] = useState(false)

  useEffect(() => {
    let cancelled = false
    orpc.billing.status()
      .then((status) => {
        if (!cancelled) setBilling(status)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load billing.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (isAdmin) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h2 className="text-sm font-semibold">Internal access</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Admin accounts bypass subscriptions and use local rolling AI limits.
          </p>
        </div>
        <UsageTab />
      </div>
    )
  }
  if (error) return <p className="text-xs text-destructive-foreground">{error}</p>
  if (!billing) return <p className="cx-shimmer text-xs">Loading billing…</p>

  const plan = billing.trial
    ? 'Pro trial'
    : billing.plan === 'studio' ? 'Studio' : billing.plan === 'pro' ? 'Pro' : 'No plan'
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-sm font-semibold">Billing</h2>
        <p className="mt-1 text-xs text-muted-foreground">Manage your plan and monthly AI credits.</p>
      </div>
      <div className="rounded-lg border border-border p-4">
        <p className="text-xs text-muted-foreground">Current plan</p>
        <p className="mt-1 text-lg font-semibold">{plan}</p>
        {billing.trial ? (
          <div className="mt-3 rounded-md bg-secondary px-3 py-2 text-xs">
            <p>Your trial ends {new Date(billing.trial.endsAt).toLocaleDateString()}.</p>
            <p className="mt-1 text-muted-foreground">
              Connect ChatGPT to use AI. Managed AI and credit top-ups unlock after trial.
            </p>
          </div>
        ) : null}
        {billing.credits ? (
          <div className="mt-3">
            <p className="text-sm">{billing.credits.remaining} AI credits remaining</p>
            {billing.credits.topUpPurchased > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {billing.credits.includedRemaining} monthly + {billing.credits.topUpRemaining} prepaid
              </p>
            ) : null}
          </div>
        ) : null}
        {billing.credits?.resetsAt ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Monthly credits reset {new Date(billing.credits.resetsAt).toLocaleDateString()}
          </p>
        ) : null}
        {billing.cancelAtPeriodEnd && billing.currentPeriodEnd ? (
          <p className="mt-3 rounded-md bg-secondary px-3 py-2 text-xs">
            Your plan ends {new Date(billing.currentPeriodEnd).toLocaleDateString()}. Access remains active until then.
          </p>
        ) : null}
      </div>
      {!billing.trial ? <CreditTopUp onBillingChange={setBilling} /> : null}
      <Button
        variant="outline"
        disabled={openingPortal || !billing.plan}
        onClick={async () => {
          setOpeningPortal(true)
          setError('')
          try {
            await authClient.customer.portal()
          } catch {
            setError('Could not open the billing portal.')
            setOpeningPortal(false)
          }
        }}
      >
        {openingPortal ? 'Opening portal…' : 'Manage billing'}
      </Button>
      {error ? <p className="text-xs text-destructive-foreground">{error}</p> : null}
    </div>
  )
}

function AdminTab() {
  const [users, setUsers] = useState<AdminUserUsage[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resetting, setResetting] = useState<string | null>(null)
  const [savingAccess, setSavingAccess] = useState<string | null>(null)
  const [savingMultiplier, setSavingMultiplier] = useState<string | null>(null)
  const [multiplierDrafts, setMultiplierDrafts] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    orpc.admin
      .listUsers()
      .then((data) => {
        if (!cancelled) {
          setUsers(data)
          setMultiplierDrafts(
            Object.fromEntries(data.map((account) => [account.id, String(account.usageMultiplier)])),
          )
        }
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

  async function handleMultiplier(account: AdminUserUsage, multiplier: number) {
    if (!Number.isInteger(multiplier) || multiplier < 1 || multiplier > 1_000_000) {
      setError('Usage multiplier must be a whole number between 1 and 1,000,000.')
      return
    }

    setSavingMultiplier(account.id)
    setError(null)
    try {
      const updated = await orpc.admin.setUsageMultiplier({ userId: account.id, multiplier })
      setUsers((current) =>
        current?.map((user) =>
          user.id === account.id
            ? {
                ...user,
                usageMultiplier: updated.usageMultiplier,
                dailyLimitUsd: updated.dailyLimitUsd,
                weeklyLimitUsd: updated.weeklyLimitUsd,
              }
            : user,
        ) ?? null,
      )
      setMultiplierDrafts((current) => ({ ...current, [account.id]: String(multiplier) }))
    } catch {
      setError(`Could not update limits for ${account.email}.`)
    } finally {
      setSavingMultiplier(null)
    }
  }

  async function handlePreviewAccess(account: AdminUserUsage) {
    const granted = !account.previewAccess
    setSavingAccess(account.id)
    setError(null)
    try {
      const updated = await orpc.admin.setPreviewAccess({ userId: account.id, granted })
      setUsers((current) =>
        current?.map((user) =>
          user.id === account.id
            ? {
                ...user,
                previewAccess: updated.previewAccess,
                previewAccessRequestedAt: updated.previewAccess
                  ? null
                  : user.previewAccessRequestedAt,
              }
            : user,
        ) ?? null,
      )
    } catch {
      setError(`Could not update preview access for ${account.email}.`)
    } finally {
      setSavingAccess(null)
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
          Manage preview access and internal AI usage limits.
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
                {!account.isAdmin && account.previewAccessRequestedAt ? (
                  <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-cx-accent">
                    Requested access
                  </span>
                ) : null}
              </p>
              <p className="truncate text-xs text-muted-foreground">{account.email}</p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                {`$${account.dailyUsd.toFixed(4)} / $${account.dailyLimitUsd.toFixed(2)} today · $${account.weeklyUsd.toFixed(4)} / $${account.weeklyLimitUsd.toFixed(2)} this week`}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              {!account.isAdmin ? (
                <Button
                  size="xs"
                  variant={account.previewAccess ? 'secondary' : 'outline'}
                  disabled={savingAccess === account.id}
                  onClick={() => handlePreviewAccess(account)}
                >
                  {savingAccess === account.id
                    ? 'Saving…'
                    : account.previewAccess
                      ? 'Revoke preview access'
                      : 'Grant preview access'}
                </Button>
              ) : null}
              <div className="flex flex-wrap gap-1">
                {MULTIPLIER_PRESETS.map((multiplier) => (
                  <Button
                    key={multiplier}
                    size="xs"
                    variant={account.usageMultiplier === multiplier ? 'secondary' : 'outline'}
                    disabled={savingMultiplier === account.id}
                    onClick={() => handleMultiplier(account, multiplier)}
                  >
                    {multiplier}×
                  </Button>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  aria-label={`Custom usage multiplier for ${account.email}`}
                  className="h-7 w-24 text-xs"
                  min={1}
                  max={1_000_000}
                  step={1}
                  type="number"
                  value={multiplierDrafts[account.id] ?? String(account.usageMultiplier)}
                  onChange={(event) =>
                    setMultiplierDrafts((current) => ({
                      ...current,
                      [account.id]: event.target.value,
                    }))
                  }
                />
                <Button
                  size="xs"
                  variant="outline"
                  disabled={savingMultiplier === account.id}
                  onClick={() =>
                    handleMultiplier(account, Number(multiplierDrafts[account.id]))
                  }
                >
                  {savingMultiplier === account.id ? 'Saving…' : 'Apply'}
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={resetting === account.id}
                  onClick={() => handleReset(account)}
                >
                  {resetting === account.id ? 'Resetting…' : 'Reset usage'}
                </Button>
              </div>
            </div>
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
  const defaultTab = typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('settings') === 'github'
    ? 'github'
    : typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('topup') === 'success'
      ? 'billing'
      : 'account'

  async function signOut() {
    // Do not leave one Loora account's ChatGPT cookie available after switching users.
    await fetch('/api/chatgpt/logout', { method: 'POST' }).catch(() => undefined)
    await authClient.signOut()
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-6">
      <Tabs defaultValue={defaultTab} className="flex max-w-md flex-col gap-6">
        <TabsList className={`grid w-full ${isAdmin ? 'grid-cols-5' : 'grid-cols-4'}`}>
          <TabsTab value="account">Account</TabsTab>
          <TabsTab value="chatgpt">ChatGPT</TabsTab>
          <TabsTab value="github">GitHub</TabsTab>
          <TabsTab value="billing">Billing</TabsTab>
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
            <Button variant="outline" size="sm" onClick={() => void signOut()}>
              <LogOutIcon data-slot="icon" />
              Sign out
            </Button>
          </div>
        </TabsPanel>

        <TabsPanel value="chatgpt" className="flex flex-col gap-5">
          <div>
            <h2 className="text-sm font-semibold">ChatGPT</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Connect your own account for ChatGPT-backed AI models.
            </p>
          </div>
          <ChatGPTAccount />
        </TabsPanel>

        <TabsPanel value="github" className="flex flex-col gap-5">
          <div>
            <h2 className="text-sm font-semibold">GitHub</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Attach read-only repository context to individual Loora designs.
            </p>
          </div>
          <GitHubAccount />
        </TabsPanel>

        <TabsPanel value="billing">
          <BillingTab isAdmin={isAdmin} />
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
