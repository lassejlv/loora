import { useEffect, useMemo, useRef, useState } from 'react'
import { formatStorageBytes } from '@loora/billing/plan-limits'
import { EllipsisIcon, SearchIcon } from '#/components/icons'
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
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Input } from '#/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { orpc } from '#/lib/orpc-client'
import { cn } from '#/lib/utils'
import type { AdminUser, AdminUserFilter } from '#/components/admin/types'

const FILTERS: { value: AdminUserFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'paid', label: 'Paid' },
  { value: 'admins', label: 'Admins' },
]

function relativeTime(value: Date | string | null) {
  if (!value) return 'Never'
  const date = value instanceof Date ? value : new Date(value)
  const diff = Date.now() - date.getTime()
  const minutes = Math.round(diff / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return date.toLocaleDateString()
}

function planLabel(account: AdminUser) {
  if (account.isAdmin) return 'Admin'
  if (account.plan === 'pro') return 'Pro'
  if (account.plan === 'studio') return 'Studio'
  if (account.plan === 'free') return 'Free'
  return 'No plan'
}

function DeleteUserDialog({
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
          <Button variant="destructive-outline" size="xs" disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
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

function UserRowActions({
  account,
  currentUserId,
  busy,
  onAction,
  onDelete,
}: {
  account: AdminUser
  currentUserId: string
  busy: boolean
  onAction: (action: AdminUserAction, account: AdminUser) => void
  onDelete: (account: AdminUser, email: string) => Promise<void>
}) {
  const isSelf = account.id === currentUserId

  return (
    <div className="flex items-center justify-end gap-1">
      {!account.isAdmin ? (
        <Button
          size="xs"
          variant={account.previewAccess ? 'secondary' : 'outline'}
          disabled={busy}
          onClick={() => onAction('previewAccess', account)}
        >
          {account.previewAccess ? 'Revoke access' : 'Grant access'}
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Actions for ${account.email}`}
            disabled={busy}
          >
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => onAction('refreshBilling', account)}>
            Refresh billing from Polar
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAction('copyId', account)}>
            Copy user ID
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {!isSelf ? (
            <DropdownMenuItem onClick={() => onAction('toggleAdmin', account)}>
              {account.isAdmin ? 'Remove admin' : 'Make admin'}
            </DropdownMenuItem>
          ) : null}
          {!isSelf ? (
            <DropdownMenuItem onClick={() => onAction('revokeSessions', account)}>
              Sign out everywhere
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            disabled={account.mcpClients === 0}
            onClick={() => onAction('revokeMcp', account)}
          >
            Disconnect MCP clients ({account.mcpClients})
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {!account.isAdmin && !isSelf ? (
        <DeleteUserDialog account={account} deleting={busy} onDelete={onDelete} />
      ) : null}
    </div>
  )
}

export type AdminUserAction =
  | 'previewAccess'
  | 'toggleAdmin'
  | 'refreshBilling'
  | 'revokeSessions'
  | 'revokeMcp'
  | 'copyId'

export function AdminUsers({
  currentUserId,
  pendingRequests,
  onChanged,
}: {
  currentUserId: string
  pendingRequests: number
  onChanged: () => void
}) {
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [filter, setFilter] = useState<AdminUserFilter>('all')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [approving, setApproving] = useState(false)
  const requestId = useRef(0)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 200)
    return () => clearTimeout(timer)
  }, [search])

  const load = useMemo(
    () => async () => {
      const id = ++requestId.current
      try {
        const rows = await orpc.admin.listUsers({
          filter,
          search: debouncedSearch || undefined,
        })
        // Ignore a response that a newer query already superseded.
        if (id === requestId.current) {
          setUsers(rows)
          setError('')
        }
      } catch {
        if (id === requestId.current) setError('Could not load users.')
      }
    },
    [filter, debouncedSearch],
  )

  useEffect(() => {
    void load()
  }, [load])

  const patchUser = (userId: string, patch: Partial<AdminUser>) => {
    setUsers((current) =>
      current?.map((row) => (row.id === userId ? { ...row, ...patch } : row)) ?? null,
    )
  }

  async function runAction(action: AdminUserAction, account: AdminUser) {
    if (action === 'copyId') {
      void navigator.clipboard?.writeText(account.id)
      setStatus(`Copied ${account.email}'s user ID.`)
      return
    }

    if (
      action === 'revokeSessions' &&
      !window.confirm(`Sign ${account.email} out of every session?`)
    ) {
      return
    }
    if (
      action === 'revokeMcp' &&
      !window.confirm(`Disconnect every MCP client authorized by ${account.email}?`)
    ) {
      return
    }

    setBusyId(account.id)
    setError('')
    setStatus('')
    try {
      if (action === 'previewAccess') {
        const granted = !account.previewAccess
        const updated = await orpc.admin.setPreviewAccess({
          userId: account.id,
          granted,
        })
        patchUser(account.id, {
          previewAccess: updated.previewAccess,
          previewAccessRequestedAt: updated.previewAccess
            ? null
            : account.previewAccessRequestedAt,
        })
        setStatus(
          `${granted ? 'Granted' : 'Revoked'} preview access for ${account.email}.`,
        )
        onChanged()
      } else if (action === 'toggleAdmin') {
        const next = !account.isAdmin
        const updated = await orpc.admin.setAdmin({ userId: account.id, isAdmin: next })
        patchUser(account.id, {
          isAdmin: updated.isAdmin,
          previewAccess: updated.previewAccess,
          plan: updated.isAdmin ? 'admin' : account.plan,
        })
        setStatus(`${next ? 'Granted' : 'Removed'} admin for ${account.email}.`)
        onChanged()
      } else if (action === 'refreshBilling') {
        const entitlement = await orpc.admin.refreshBilling({ userId: account.id })
        patchUser(account.id, {
          plan: account.isAdmin ? 'admin' : entitlement.plan,
          subscriptionStatus: entitlement.subscriptionStatus,
          billingAccess: account.isAdmin || entitlement.accessGranted,
        })
        setStatus(
          `Synced ${account.email}: ${entitlement.plan ?? 'no plan'}` +
            `${entitlement.subscriptionStatus ? ` (${entitlement.subscriptionStatus})` : ''}.`,
        )
      } else if (action === 'revokeSessions') {
        const { revoked } = await orpc.admin.revokeSessions({ userId: account.id })
        patchUser(account.id, { lastSeenAt: null })
        setStatus(`Signed ${account.email} out of ${revoked} session(s).`)
        onChanged()
      } else if (action === 'revokeMcp') {
        const { tokens } = await orpc.admin.revokeMcpAccess({ userId: account.id })
        patchUser(account.id, { mcpClients: 0 })
        setStatus(`Disconnected ${tokens} MCP token(s) for ${account.email}.`)
        onChanged()
      }
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : `Could not update ${account.email}.`,
      )
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(account: AdminUser, email: string) {
    setBusyId(account.id)
    setError('')
    try {
      await orpc.admin.deleteUser({ userId: account.id, email })
      setUsers((current) => current?.filter((row) => row.id !== account.id) ?? null)
      setStatus(`Deleted ${account.email}.`)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not delete ${account.email}.`)
      throw err
    } finally {
      setBusyId(null)
    }
  }

  async function approveAll() {
    setApproving(true)
    setError('')
    try {
      const { granted } = await orpc.admin.approvePendingPreviewAccess()
      setStatus(`Approved ${granted} pending request(s).`)
      await load()
      onChanged()
    } catch {
      setError('Could not approve the pending requests.')
    } finally {
      setApproving(false)
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Users</h2>
        {pendingRequests > 0 ? (
          <Button size="xs" variant="outline" disabled={approving} onClick={() => void approveAll()}>
            {approving
              ? 'Approving…'
              : `Approve ${pendingRequests} pending request${pendingRequests === 1 ? '' : 's'}`}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="ps-7"
            placeholder="Search name or email"
            aria-label="Search users"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="flex items-center gap-px rounded-md border border-line p-0.5">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={cn(
                'rounded-sm px-2 py-1 text-xs transition-colors',
                filter === option.value
                  ? 'bg-surface-2 font-medium text-foreground shadow-panel'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="text-xs text-destructive-foreground">{error}</p> : null}
      {status ? <p className="text-xs text-muted-foreground">{status}</p> : null}

      <div className="overflow-x-auto rounded-md border border-line bg-surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-end">Files</TableHead>
              <TableHead className="text-end">Storage</TableHead>
              <TableHead>Last seen</TableHead>
              <TableHead className="text-end">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users === null ? (
              <TableRow>
                <TableCell colSpan={6} className="text-xs text-muted-foreground">
                  Loading users…
                </TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-xs text-muted-foreground">
                  No users match this view.
                </TableCell>
              </TableRow>
            ) : (
              users.map((account) => (
                <TableRow key={account.id}>
                  <TableCell>
                    <div className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-1.5 truncate text-xs font-medium">
                        {account.name}
                        {account.isAdmin ? <Badge variant="secondary">Admin</Badge> : null}
                        {!account.isAdmin && account.previewAccessRequestedAt ? (
                          <Badge variant="outline">Requested</Badge>
                        ) : null}
                        {account.id === currentUserId ? (
                          <span className="text-2xs text-muted-foreground">(you)</span>
                        ) : null}
                      </span>
                      <span className="truncate text-2xs text-muted-foreground">
                        {account.email} · joined {relativeTime(account.createdAt)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="text-xs">{planLabel(account)}</span>
                      {account.subscriptionStatus ? (
                        <span className="text-2xs text-muted-foreground">
                          {account.subscriptionStatus}
                          {account.cancelAtPeriodEnd ? ' · cancels' : ''}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-end text-xs tabular-nums">
                    <div className="flex flex-col items-end">
                      <span>{account.designs.toLocaleString()}</span>
                      {account.openBranches > 0 ? (
                        <span className="text-2xs text-muted-foreground">
                          {account.openBranches} open
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-end text-xs tabular-nums">
                    <div className="flex flex-col items-end">
                      <span>{formatStorageBytes(account.storageBytes)}</span>
                      {account.assets > 0 ? (
                        <span className="text-2xs text-muted-foreground">
                          {account.assets} files
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">{relativeTime(account.lastSeenAt)}</TableCell>
                  <TableCell>
                    <UserRowActions
                      account={account}
                      currentUserId={currentUserId}
                      busy={busyId === account.id}
                      onAction={(action, target) => void runAction(action, target)}
                      onDelete={handleDelete}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}
