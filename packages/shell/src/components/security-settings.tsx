import { useEffect, useState } from 'react'
import { authClient } from '@loora/auth/client'
import { getAuthenticatorName } from '@better-auth/passkey'
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@loora/ui/alert-dialog'
import { Button } from '@loora/ui/button'
import { Input } from '@loora/ui/input'
import { PlusIcon, Trash2Icon } from '@loora/ui/icons'

type Passkey = {
  id: string
  name: string | null
  aaguid: string | null
  createdAt: Date | null
}

function passkeyLabel(passkey: Passkey): string {
  return (
    passkey.name ||
    (passkey.aaguid ? getAuthenticatorName(passkey.aaguid) : null) ||
    'Passkey'
  )
}

function formatDate(date: Date | null): string {
  if (!date) return ''
  try {
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return ''
  }
}

export function SecuritySettings() {
  const [passkeys, setPasskeys] = useState<Passkey[]>([])
  const [loaded, setLoaded] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  async function refresh() {
    try {
      const { data } = await authClient.passkey.listUserPasskeys()
      setPasskeys((data ?? []) as Passkey[])
    } catch {
      setError('Could not load passkeys.')
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function addPasskey() {
    setAdding(true)
    setError(null)
    try {
      const { error: addError } = await authClient.passkey.addPasskey()
      if (addError) {
        setError(addError.message ?? 'Could not add passkey.')
      } else {
        await refresh()
      }
    } catch {
      setError('Could not add passkey.')
    } finally {
      setAdding(false)
    }
  }

  async function deletePasskey(id: string) {
    setError(null)
    try {
      const { error: delError } = await authClient.passkey.deletePasskey({ id })
      if (delError) {
        setError(delError.message ?? 'Could not remove passkey.')
      } else {
        setPasskeys((current) => current.filter((p) => p.id !== id))
      }
    } catch {
      setError('Could not remove passkey.')
    }
  }

  async function saveRename(id: string) {
    setError(null)
    try {
      const { error: updError } = await authClient.passkey.updatePasskey({
        id,
        name: renameValue,
      })
      if (updError) {
        setError(updError.message ?? 'Could not rename passkey.')
      } else {
        setPasskeys((current) =>
          current.map((p) => (p.id === id ? { ...p, name: renameValue } : p)),
        )
        setRenamingId(null)
      }
    } catch {
      setError('Could not rename passkey.')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold">Passkeys</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Sign in to Loora with a passkey instead of a password. Add one from
            your laptop, phone, or a hardware key — it stays on your device.
          </p>
        </div>

        <div>
          <Button size="sm" variant="outline" disabled={adding} onClick={() => void addPasskey()}>
            <PlusIcon />
            {adding ? 'Waiting for authenticator…' : 'Add passkey'}
          </Button>
        </div>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        {loaded ? (
          passkeys.length > 0 ? (
            <ul className="divide-y divide-border border border-line rounded-lg">
              {passkeys.map((passkey) => (
                <li key={passkey.id} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    {renamingId === passkey.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={renameValue}
                          autoFocus
                          placeholder={passkeyLabel(passkey)}
                          className="h-7 max-w-48 text-xs"
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveRename(passkey.id)
                            if (e.key === 'Escape') setRenamingId(null)
                          }}
                        />
                        <Button
                          size="xs"
                          onClick={() => void saveRename(passkey.id)}
                        >
                          Save
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setRenamingId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <>
                        <p className="truncate text-sm font-medium">
                          {passkeyLabel(passkey)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Added {formatDate(passkey.createdAt)}
                        </p>
                      </>
                    )}
                  </div>
                  {renamingId !== passkey.id && (
                    <div className="flex items-center gap-1">
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => {
                          setRenamingId(passkey.id)
                          setRenameValue(passkey.name ?? '')
                        }}
                      >
                        Rename
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger
                          render={
                            <Button size="icon-xs" variant="ghost" aria-label="Remove passkey">
                              <Trash2Icon />
                            </Button>
                          }
                        />
                        <AlertDialogPopup>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove passkey?</AlertDialogTitle>
                            <AlertDialogDescription>
                              You will no longer be able to sign in with this passkey.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogClose render={<Button variant="outline" size="sm">Cancel</Button>} />
                            <AlertDialogClose
                              render={
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => void deletePasskey(passkey.id)}
                                >
                                  Remove
                                </Button>
                              }
                            />
                          </AlertDialogFooter>
                        </AlertDialogPopup>
                      </AlertDialog>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              No passkeys yet. Add one to sign in without a password.
            </p>
          )
        ) : (
          <p className="text-xs text-muted-foreground">Loading…</p>
        )}
      </section>
    </div>
  )
}