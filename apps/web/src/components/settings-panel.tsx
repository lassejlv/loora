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
import { authClient } from '@loora/auth/client'
import { orpc } from '#/lib/orpc-client'
import { GitHubAccount } from '#/components/github-account'
import { FigmaAccount } from '#/components/figma-account'
import { McpSessions } from '#/components/mcp-sessions'
import { PanelLoading, PanelShell } from '#/components/panel-shell'
import { ShortcutsSettings } from '#/components/shortcuts-settings'
import { clearWelcomeSeen } from '#/components/welcome-dialog'
import { editorSearchParams, type IntegrationTab, type SettingsTab } from '#/lib/url-state'
import type { ShortcutConfig } from '#/lib/shortcuts'
import { getThemePreference, setThemePreference, type ThemePreference } from '#/lib/theme'

type BillingStatus = Awaited<ReturnType<typeof orpc.billing.status>>

interface AdminUser {
  id: string
  name: string
  email: string
  isAdmin: boolean
  previewAccess: boolean
  previewAccessRequestedAt: Date | null
}

function BillingTab({
  isAdmin,
  billing,
  loadError,
}: {
  isAdmin: boolean
  billing: BillingStatus | null
  loadError: boolean
}) {
  const [error, setError] = useState(loadError ? 'Could not load billing.' : '')
  const [openingPortal, setOpeningPortal] = useState(false)

  if (isAdmin) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold">Internal access</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Admin accounts bypass subscriptions and keep full editor access.
          </p>
        </div>
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
        <p className="mt-1 text-xs text-muted-foreground">
          Manage the plan that unlocks the editor, branches, MCP, and exports.
        </p>
      </div>
      <div className="rounded-lg border border-border p-4">
        <p className="text-xs text-muted-foreground">Current plan</p>
        <p className="mt-1 text-lg font-semibold">{plan}</p>
        {billing.trial ? (
          <div className="mt-3 rounded-md bg-secondary px-3 py-2 text-xs">
            <p>Your trial ends {new Date(billing.trial.endsAt).toLocaleDateString()}.</p>
            <p className="mt-1 text-muted-foreground">
              Full canvas, branches, exports, and the MCP server are included for the whole trial.
            </p>
          </div>
        ) : null}
        {billing.cancelAtPeriodEnd && billing.currentPeriodEnd ? (
          <p className="mt-3 rounded-md bg-secondary px-3 py-2 text-xs">
            Your plan ends {new Date(billing.currentPeriodEnd).toLocaleDateString()}. Access remains active until then.
          </p>
        ) : null}
      </div>
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

function AdminDeleteUserDialog({
  account,
  deleting,
  onDelete,
}: {
  account: AdminUser
  deleting: boolean
  onDelete: (account: AdminUser, email: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const confirmed = email === account.email

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setEmail('')
      }}
    >
      <AlertDialogTrigger
        render={
          <Button variant="destructive" size="xs" disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete account'}
          </Button>
        }
      />
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {account.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes {account.email} and all of their designs, assets, and
            integrations. Type their email to confirm. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="px-4 pb-1.5">
          <Input
            autoComplete="off"
            autoFocus
            aria-label={`Type ${account.email} to confirm deletion`}
            placeholder={account.email}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" size="sm">Cancel</Button>} />
          <Button
            variant="destructive"
            size="sm"
            disabled={!confirmed || deleting}
            onClick={() => {
              void onDelete(account, email)
                .then(() => {
                  setOpen(false)
                  setEmail('')
                })
                .catch(() => undefined)
            }}
          >
            {deleting ? 'Deleting…' : 'Delete account'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  )
}

function AdminTab({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savingAccess, setSavingAccess] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

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

  async function handlePreviewAccess(account: AdminUser) {
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

  async function handleDelete(account: AdminUser, email: string) {
    setDeleting(account.id)
    setError(null)
    try {
      await orpc.admin.deleteUser({ userId: account.id, email })
      setUsers((current) => current?.filter((user) => user.id !== account.id) ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not delete ${account.email}.`)
      throw err
    } finally {
      setDeleting(null)
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
          Manage preview access.
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
                  <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-cx-accent">
                    Admin
                  </span>
                ) : null}
                {!account.isAdmin && account.previewAccessRequestedAt ? (
                  <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-cx-accent">
                    Requested access
                  </span>
                ) : null}
              </p>
              <p className="truncate text-xs text-muted-foreground">{account.email}</p>
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
              {!account.isAdmin && account.id !== currentUserId ? (
                <AdminDeleteUserDialog
                  account={account}
                  deleting={deleting === account.id}
                  onDelete={handleDelete}
                />
              ) : null}
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
          Permanently delete your account, designs, and assets.
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
                This permanently deletes your account and all designs, assets, and connected
                integrations. This cannot be undone.
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
}: {
  onClose?: () => void
  shortcutConfig: ShortcutConfig
  onShortcutConfigChange: (next: ShortcutConfig) => void
}) {
  const { data: session } = authClient.useSession()
  const isAdmin = session?.user.isAdmin === true
  const [billing, setBilling] = useState<BillingStatus | null>(null)
  const [billingLoadFailed, setBillingLoadFailed] = useState(false)
  const [{ settings, integration }, setUrlState] = useQueryStates(editorSearchParams, {
    history: 'replace',
  })
  const showBilling = billing?.required === true || billingLoadFailed
  const tab: SettingsTab = settings === 'billing' && billing?.required === false
    ? 'account'
    : settings ?? 'account'
  const integrationTab: IntegrationTab = integration ?? 'mcp'

  useEffect(() => {
    let cancelled = false
    orpc.billing.status()
      .then((status) => {
        if (!cancelled) setBilling(status)
      })
      .catch(() => {
        if (!cancelled) setBillingLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function signOut() {
    clearWelcomeSeen()
    await authClient.signOut()
  }

  return (
    <PanelShell title="Settings" onClose={onClose} bodyClassName="p-4" className="bg-transparent">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = value as SettingsTab
          if (next === 'integrations') void setUrlState({ settings: next })
          else void setUrlState({ settings: next, integration: null })
        }}
        className="flex flex-col gap-4"
      >
        <TabsList
          className={`grid w-full grid-cols-3 ${
            isAdmin
              ? showBilling ? 'sm:grid-cols-5' : 'sm:grid-cols-4'
              : showBilling ? 'sm:grid-cols-4' : 'sm:grid-cols-3'
          }`}
        >
          <TabsTab value="account">Account</TabsTab>
          <TabsTab value="integrations">Integrations</TabsTab>
          {showBilling ? <TabsTab value="billing">Billing</TabsTab> : null}
          <TabsTab value="shortcuts">Shortcuts</TabsTab>
          {isAdmin ? <TabsTab value="admin">Admin</TabsTab> : null}
        </TabsList>

        <TabsPanel value="account" className="flex flex-col gap-4">
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
          <AppearanceSection />
          <DeleteAccountSection />
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
            <TabsList className="grid w-full grid-cols-3">
              <TabsTab value="mcp">MCP</TabsTab>
              <TabsTab value="github">GitHub</TabsTab>
              <TabsTab value="figma">Figma</TabsTab>
            </TabsList>
            <TabsPanel value="mcp" id="integration-mcp">
              <McpSessions />
            </TabsPanel>
            <TabsPanel value="github" id="integration-github">
              <GitHubAccount />
            </TabsPanel>
            <TabsPanel value="figma" id="integration-figma">
              <FigmaAccount />
            </TabsPanel>
          </Tabs>
        </TabsPanel>

        {showBilling ? (
          <TabsPanel value="billing">
            <BillingTab isAdmin={isAdmin} billing={billing} loadError={billingLoadFailed} />
          </TabsPanel>
        ) : null}

        <TabsPanel value="shortcuts">
          <ShortcutsSettings
            config={shortcutConfig}
            onChange={onShortcutConfigChange}
          />
        </TabsPanel>

        {isAdmin && session?.user.id ? (
          <TabsPanel value="admin">
            <AdminTab currentUserId={session.user.id} />
          </TabsPanel>
        ) : null}
      </Tabs>
    </PanelShell>
  )
}
