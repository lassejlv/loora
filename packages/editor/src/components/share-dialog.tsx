import { useCallback, useEffect, useState } from 'react'
import { CheckIcon, Link2Icon, Trash2Icon, XIcon } from '@loora/ui/icons'
import { Button } from '@loora/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@loora/ui/dialog'
import { Input } from '@loora/ui/input'
import { Spinner } from '@loora/ui/spinner'
import { orpc } from '@loora/rpc/client'
import { appUrl } from '@loora/platform'
import { copyText } from '../lib/copy-text'
import { cn } from '@loora/ui/utils'

type ShareRole = 'view' | 'edit'
type LinkAccess = 'restricted' | ShareRole

interface Collaborator {
  id: string
  email: string
  role: ShareRole
  name: string | null
  image: string | null
  userId: string | null
  acceptedAt: number | null
  createdAt: number
}

interface ShareState {
  role: 'owner' | ShareRole
  source: 'owner' | 'share' | 'link'
  linkAccess: LinkAccess
  owner: { id: string; name: string; email: string; image: string | null } | null
  collaborators: Collaborator[]
}

const linkLabels: Record<LinkAccess, string> = {
  restricted: 'Only invited people',
  view: 'Anyone with the link can view',
  edit: 'Anyone with the link can edit',
}

function RoleSelect({
  value,
  disabled,
  onChange,
  className,
}: {
  value: ShareRole
  disabled?: boolean
  onChange: (role: ShareRole) => void
  className?: string
}) {
  return (
    <select
      aria-label="Access level"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as ShareRole)}
      className={cn(
        'h-7 rounded-md border bg-background px-1.5 text-xs outline-none focus-visible:border-ring disabled:opacity-50',
        className,
      )}
    >
      <option value="view">Can view</option>
      <option value="edit">Can edit</option>
    </select>
  )
}

export interface ShareClient {
  get: (input: { designId: string }) => Promise<unknown>
  invite: (input: {
    designId: string
    email: string
    role: ShareRole
  }) => Promise<unknown>
  setLinkAccess: (input: {
    designId: string
    linkAccess: LinkAccess
  }) => Promise<unknown>
  setRole: (input: {
    designId: string
    shareId: string
    role: ShareRole
  }) => Promise<unknown>
  revoke: (input: { designId: string; shareId: string }) => Promise<unknown>
  leave: (input: { designId: string }) => Promise<unknown>
}

export function ShareDialog({
  designId,
  open,
  onOpenChange,
  client,
}: {
  designId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  client?: ShareClient
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-lg">
        <DialogPanel>
          <DialogHeader>
            <DialogTitle>Share</DialogTitle>
            <DialogDescription>
              Invite people by email, or let anyone with the link in.
            </DialogDescription>
          </DialogHeader>
          <ShareDialogContent
            designId={designId}
            onOpenChange={onOpenChange}
            client={client}
          />
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  )
}

// The RPC client is a proxy that mints a fresh object on every property
// access, so `orpc.share` must be read once here. Reading it inline as a
// default argument would hand the component a new client identity on every
// render, and the load effect would refetch forever.
const shareClient = orpc.share as unknown as ShareClient

export function ShareDialogContent({
  designId,
  onOpenChange,
  // Injected in tests. Module mocks are process-wide here, and mocking the
  // whole RPC client from one suite breaks every other suite that shares it.
  client = shareClient,
}: {
  designId: string
  onOpenChange: (open: boolean) => void
  client?: ShareClient
}) {
  const [state, setState] = useState<ShareState | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<ShareRole>('edit')
  const [inviting, setInviting] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setState((await client.get({ designId })) as ShareState)
    } catch {
      setError('This design could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [client, designId])

  useEffect(() => {
    void load()
  }, [load])

  const isOwner = state?.role === 'owner'
  // The public link, which on the desktop app is loora.design rather than
  // the origin the window happens to be served from.
  const link = appUrl(`/design/${designId}`)

  const copyLink = async () => {
    await copyText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 1_500)
  }

  const invite = async () => {
    const value = email.trim()
    if (!value || inviting) return
    setInviting(true)
    setError(null)
    try {
      await client.invite({ designId, email: value, role: inviteRole })
      setEmail('')
      await load()
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : 'That invitation could not be sent.',
      )
    } finally {
      setInviting(false)
    }
  }

  const setLinkAccess = async (linkAccess: LinkAccess) => {
    if (!state) return
    setState({ ...state, linkAccess })
    try {
      await client.setLinkAccess({ designId, linkAccess })
    } catch {
      setError('The link setting could not be saved.')
      await load()
    }
  }

  return (
    <>
      {state && !isOwner ? (
        <p className="mb-3 text-xs text-muted-foreground">
          You are working in a design {state.owner?.name || 'somebody else'}{' '}
          owns.
        </p>
      ) : null}
      {loading && !state ? (
            <div className="grid place-items-center py-8">
              <Spinner />
            </div>
          ) : null}

          {state ? (
            <div className="space-y-4">
              {isOwner ? (
                <div className="flex items-center gap-2">
                  <Input
                    aria-label="Email address"
                    type="email"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void invite()
                    }}
                  />
                  <RoleSelect value={inviteRole} onChange={setInviteRole} />
                  <Button
                    size="sm"
                    onClick={() => void invite()}
                    disabled={inviting || email.trim().length === 0}
                  >
                    {inviting ? <Spinner className="size-3.5" /> : 'Invite'}
                  </Button>
                </div>
              ) : null}

              {error ? (
                <p className="text-xs text-destructive">{error}</p>
              ) : null}

              <div className="space-y-1">
                {state.owner ? (
                  <div className="flex items-center gap-2 rounded-md px-1 py-1.5">
                    <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-[10px] font-medium">
                      {state.owner.image ? (
                        <img
                          src={state.owner.image}
                          alt=""
                          className="size-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        state.owner.email.slice(0, 2).toUpperCase()
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">
                        {state.owner.name || state.owner.email}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {state.owner.email}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      Owner
                    </span>
                  </div>
                ) : null}

                {state.collaborators.map((collaborator) => (
                  <div
                    key={collaborator.id}
                    className="flex items-center gap-2 rounded-md px-1 py-1.5"
                  >
                    <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-[10px] font-medium">
                      {collaborator.image ? (
                        <img
                          src={collaborator.image}
                          alt=""
                          className="size-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        collaborator.email.slice(0, 2).toUpperCase()
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">
                        {collaborator.name || collaborator.email}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {collaborator.acceptedAt
                          ? collaborator.email
                          : `${collaborator.email} · invited`}
                      </span>
                    </span>
                    <RoleSelect
                      value={collaborator.role}
                      disabled={!isOwner}
                      onChange={async (role) => {
                        await client.setRole({
                          designId,
                          shareId: collaborator.id,
                          role,
                        })
                        await load()
                      }}
                    />
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Remove ${collaborator.email}`}
                      onClick={async () => {
                        await client.revoke({
                          designId,
                          shareId: collaborator.id,
                        })
                        await load()
                      }}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="space-y-2 border-t pt-3">
                <div className="flex items-center gap-2">
                  <Link2Icon className="size-3.5 text-muted-foreground" />
                  {isOwner ? (
                    <select
                      aria-label="Link access"
                      value={state.linkAccess}
                      onChange={(event) =>
                        void setLinkAccess(event.target.value as LinkAccess)
                      }
                      className="h-7 flex-1 rounded-md border bg-background px-1.5 text-xs outline-none focus-visible:border-ring"
                    >
                      <option value="restricted">{linkLabels.restricted}</option>
                      <option value="view">{linkLabels.view}</option>
                      <option value="edit">{linkLabels.edit}</option>
                    </select>
                  ) : (
                    <span className="flex-1 text-xs text-muted-foreground">
                      {linkLabels[state.linkAccess]}
                    </span>
                  )}
                  <Button size="sm" variant="outline" onClick={() => void copyLink()}>
                    {copied ? <CheckIcon /> : <Link2Icon />}
                    {copied ? 'Copied' : 'Copy link'}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {state.linkAccess === 'restricted'
                    ? 'People you have not invited will not be able to open this link.'
                    : 'Anyone signed in who has this link can open the design.'}
                </p>
              </div>

              {!isOwner ? (
                <div className="flex justify-end pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await client.leave({ designId })
                      onOpenChange(false)
                    }}
                  >
                    <XIcon />
                    Leave this design
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
    </>
  )
}
