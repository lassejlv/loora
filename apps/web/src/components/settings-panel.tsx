import { useEffect, useState } from 'react'
import { useQueryStates } from 'nuqs'
import { LogOutIcon } from '#/components/icons'
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'
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
import { FigmaAccount } from '#/components/figma-account'
import { McpSessions } from '#/components/mcp-sessions'
import { PanelLoading, PanelShell } from '#/components/panel-shell'
import { ShortcutsSettings } from '#/components/shortcuts-settings'
import { AgentInstructionsSettings } from '#/components/agent-instructions-settings'
import { clearWelcomeSeen } from '#/components/welcome-dialog'
import { editorSearchParams, type IntegrationTab, type SettingsTab } from '#/lib/url-state'
import type { ShortcutConfig } from '#/lib/shortcuts'
import { getThemePreference, setThemePreference, type ThemePreference } from '#/lib/theme'

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
    return <PanelLoading label="Loading usage…" />
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
  if (!billing) return <PanelLoading label="Loading billing…" />

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
    return <PanelLoading label="Loading users…" rows={4} />
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

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

interface PublishedLink {
  id: string
  designId: string
  elementId: string
  expiresAt: number
  designName: string
  elementName: string | null
}

function PublishedLinksSection() {
  const [links, setLinks] = useState<PublishedLink[] | null>(null)
  const [error, setError] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    orpc.publish
      .listAll()
      .then((rows) => {
        if (!cancelled) setLinks(rows)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function copyLink(id: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/p/${id}`)
      setCopiedId(id)
      window.setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 2000)
    } catch {
      // Row link stays visible for a manual copy.
    }
  }

  async function deleteLink(id: string) {
    setBusyId(id)
    try {
      await orpc.publish.delete({ id })
      setLinks((current) => current?.filter((link) => link.id !== id) ?? current)
    } catch {
      setError(true)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t pt-6">
      <div>
        <h2 className="text-sm font-semibold">Published links</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Live public links to your pages. Each expires 12 hours after publishing; delete one to
          take it offline immediately.
        </p>
      </div>
      {error ? (
        <p className="text-xs text-destructive">Could not load published links.</p>
      ) : links === null ? (
        <p className="cx-shimmer text-xs">Loading links…</p>
      ) : links.length === 0 ? (
        <p className="text-xs text-muted-foreground">No active links.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {links.map((link) => (
            <li key={link.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <a
                  href={`/p/${link.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-xs font-medium hover:underline"
                >
                  {link.elementName || link.designName}
                </a>
                <p className="truncate text-[11px] text-muted-foreground">
                  {link.designName} · expires in{' '}
                  {Math.max(1, Math.round((link.expiresAt - Date.now()) / 3_600_000))}h
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => void copyLink(link.id)}
              >
                {copiedId === link.id ? 'Copied' : 'Copy'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5 text-xs text-destructive-foreground"
                disabled={busyId === link.id}
                onClick={() => void deleteLink(link.id)}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AppearanceSection() {
  const [preference, setPreference] = useState<ThemePreference>(() => getThemePreference())

  return (
    <div className="flex flex-col gap-3 border-t pt-6">
      <div>
        <h2 className="text-sm font-semibold">Appearance</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Theme for this device. System follows your OS setting.
        </p>
      </div>
      <div className="flex gap-1.5">
        {THEME_OPTIONS.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={preference === option.value ? 'secondary' : 'outline'}
            onClick={() => {
              setThemePreference(option.value)
              setPreference(option.value)
            }}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

function DeleteAccountSection() {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function deleteAccount() {
    setDeleting(true)
    setError(null)
    try {
      await orpc.auth.deleteAccount()
      clearWelcomeSeen()
      await fetch('/api/chatgpt/logout', { method: 'POST' }).catch(() => undefined)
      window.location.href = '/'
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete account.')
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t pt-6">
      <div>
        <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Permanently delete your account, designs, chats, and assets.
        </p>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button variant="destructive" size="sm" disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete account'}
              </Button>
            }
          />
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete account?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes your account and all designs, chats, assets, and
                connected integrations. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="outline" size="sm">Cancel</Button>} />
              <AlertDialogClose
                render={
                  <Button variant="destructive" size="sm" onClick={() => void deleteAccount()}>
                    Delete account
                  </Button>
                }
              />
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      </div>
    </div>
  )
}

export function SettingsPanel({
  onClose,
  shortcutConfig,
  onShortcutConfigChange,
  agentSystemPrompt,
  onSaveAgentSystemPrompt,
}: {
  onClose?: () => void
  shortcutConfig: ShortcutConfig
  onShortcutConfigChange: (next: ShortcutConfig) => void
  agentSystemPrompt: string | null
  onSaveAgentSystemPrompt: (prompt: string) => Promise<void>
}) {
  const { data: session } = authClient.useSession()
  const isAdmin = session?.user.isAdmin === true
  const [{ settings, integration }, setUrlState] = useQueryStates(editorSearchParams, {
    history: 'replace',
  })
  const tab: SettingsTab = settings ?? 'account'
  const integrationTab: IntegrationTab = integration ?? 'chatgpt'

  async function signOut() {
    // Do not leave one Loora account's ChatGPT cookie available after switching users.
    clearWelcomeSeen()
    await fetch('/api/chatgpt/logout', { method: 'POST' }).catch(() => undefined)
    await authClient.signOut()
  }

  return (
    <PanelShell title="Settings" onClose={onClose} bodyClassName="p-6">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = value as SettingsTab
          if (next === 'integrations') void setUrlState({ settings: next })
          else void setUrlState({ settings: next, integration: null })
        }}
        className="flex flex-col gap-6"
      >
        <TabsList className={`grid w-full grid-cols-3 ${isAdmin ? 'sm:grid-cols-6' : 'sm:grid-cols-5'}`}>
          <TabsTab value="account">Account</TabsTab>
          <TabsTab value="agent">Agent</TabsTab>
          <TabsTab value="integrations">Integrations</TabsTab>
          <TabsTab value="billing">Billing</TabsTab>
          <TabsTab value="shortcuts">Shortcuts</TabsTab>
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
          <PublishedLinksSection />
          <AppearanceSection />
          <DeleteAccountSection />
        </TabsPanel>

        <TabsPanel value="agent">
          {agentSystemPrompt === null ? (
            <PanelLoading label="Loading agent instructions…" />
          ) : (
            <AgentInstructionsSettings
              savedPrompt={agentSystemPrompt}
              onSave={onSaveAgentSystemPrompt}
            />
          )}
        </TabsPanel>

        <TabsPanel value="integrations" className="flex flex-col gap-4">
          <div>
            <h2 className="text-sm font-semibold">Integrations</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Connect external accounts and agents to Loora.
            </p>
          </div>
          <Tabs
            value={integrationTab}
            onValueChange={(value) => {
              void setUrlState({
                settings: 'integrations',
                integration: value as IntegrationTab,
              })
            }}
            className="flex flex-col gap-4"
          >
            <TabsList className="grid w-full grid-cols-4">
              <TabsTab value="chatgpt">ChatGPT</TabsTab>
              <TabsTab value="github">GitHub</TabsTab>
              <TabsTab value="figma">Figma</TabsTab>
              <TabsTab value="mcp">MCP</TabsTab>
            </TabsList>
            <TabsPanel value="chatgpt" id="integration-chatgpt">
              <ChatGPTAccount />
            </TabsPanel>
            <TabsPanel value="github" id="integration-github">
              <GitHubAccount />
            </TabsPanel>
            <TabsPanel value="figma" id="integration-figma">
              <FigmaAccount />
            </TabsPanel>
            <TabsPanel value="mcp" id="integration-mcp">
              <McpSessions />
            </TabsPanel>
          </Tabs>
        </TabsPanel>

        <TabsPanel value="billing">
          <BillingTab isAdmin={isAdmin} />
        </TabsPanel>

        <TabsPanel value="shortcuts">
          <ShortcutsSettings
            config={shortcutConfig}
            onChange={onShortcutConfigChange}
          />
        </TabsPanel>

        {isAdmin ? (
          <TabsPanel value="admin">
            <AdminTab />
          </TabsPanel>
        ) : null}
      </Tabs>
    </PanelShell>
  )
}
