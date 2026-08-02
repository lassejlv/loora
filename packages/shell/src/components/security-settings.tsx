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
import { Dialog, DialogDescription, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@loora/ui/dialog'
import { Input } from '@loora/ui/input'
import {
  OTPField,
  OTPFieldInput,
  OTPFieldSeparator,
} from '@loora/ui/otp-field'
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

function TwoFactorSection() {
  const { data: session } = authClient.useSession()
  const enabled = session?.user?.twoFactorEnabled === true
  const [enrolling, setEnrolling] = useState(false)
  const [disabling, setDisabling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [totpUri, setTotpUri] = useState<string | null>(null)
  const [verifyCode, setVerifyCode] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)

  async function startEnroll() {
    setEnrolling(true)
    setError(null)
    setNotice(null)
    try {
      const { data, error: enableError } = await authClient.twoFactor.enable({
        password,
      })
      if (enableError) {
        setError(enableError.message ?? 'Could not enable 2FA.')
      } else if (data) {
        setTotpUri(data.totpURI ?? null)
        setBackupCodes(data.backupCodes ?? null)
      }
    } catch {
      setError('Could not enable 2FA.')
    } finally {
      setEnrolling(false)
    }
  }

  async function verifyTotp() {
    setEnrolling(true)
    setError(null)
    try {
      const { error: verifyError } = await authClient.twoFactor.verifyTotp({
        code: verifyCode,
      })
      if (verifyError) {
        setError(verifyError.message ?? 'Verification failed.')
      } else {
        setNotice('Two-factor authentication is now enabled.')
        setTotpUri(null)
        setVerifyCode('')
        setPassword('')
      }
    } catch {
      setError('Verification failed.')
    } finally {
      setEnrolling(false)
    }
  }

  async function disable() {
    setDisabling(true)
    setError(null)
    try {
      const { error: disableError } = await authClient.twoFactor.disable({
        password,
      })
      if (disableError) {
        setError(disableError.message ?? 'Could not disable 2FA.')
      } else {
        setNotice('Two-factor authentication is disabled.')
        setPassword('')
      }
    } catch {
      setError('Could not disable 2FA.')
    } finally {
      setDisabling(false)
    }
  }

  const showEnrollForm = !enabled && !totpUri
  const showVerifyForm = totpUri !== null

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold">Two-factor authentication</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Add a second step at sign-in with an authenticator app (TOTP) or a code sent
          to your email.
        </p>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}

      {enabled ? (
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600">
            Enabled
          </span>
          <Button size="xs" variant="outline" onClick={() => setDisabling(true)}>
            Disable
          </Button>
        </div>
      ) : showVerifyForm ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Scan this QR code with your authenticator app, then enter the 6-digit code.
          </p>
          {totpUri ? (
            <div className="rounded-lg border border-line bg-surface p-4">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(totpUri)}`}
                alt="QR code for TOTP enrollment"
                width={200}
                height={200}
                className="mx-auto"
              />
            </div>
          ) : null}
          {backupCodes && backupCodes.length > 0 ? (
            <div className="rounded-lg border border-line bg-surface p-3">
              <p className="mb-1 text-xs font-medium">Backup codes</p>
              <p className="mb-2 text-xs text-muted-foreground">
                Save these now — you won't see them again.
              </p>
              <div className="grid grid-cols-2 gap-1 font-mono text-xs">
                {backupCodes.map((code) => (
                  <span key={code}>{code}</span>
                ))}
              </div>
            </div>
          ) : null}
          <OTPField
            length={6}
            value={verifyCode}
            onValueChange={setVerifyCode}
          >
            <OTPFieldInput />
            <OTPFieldSeparator />
            <OTPFieldInput />
            <OTPFieldSeparator />
            <OTPFieldInput />
            <OTPFieldSeparator />
            <OTPFieldInput />
            <OTPFieldSeparator />
            <OTPFieldInput />
            <OTPFieldSeparator />
            <OTPFieldInput />
          </OTPField>
          <Button size="sm" disabled={enrolling || verifyCode.length < 6} onClick={() => void verifyTotp()}>
            {enrolling ? 'Verifying…' : 'Verify and enable'}
          </Button>
        </div>
      ) : showEnrollForm ? (
        <div className="flex flex-col gap-3">
          <Input
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="max-w-64"
          />
          <Button size="sm" disabled={enrolling || !password} onClick={() => void startEnroll()}>
            {enrolling ? 'Working…' : 'Enable 2FA'}
          </Button>
        </div>
      ) : null}

      {disabling && enabled ? (
        <Dialog open onOpenChange={() => setDisabling(false)}>
          <DialogPopup className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Disable two-factor authentication?</DialogTitle>
              <DialogDescription>
                Enter your password to confirm. Your account will be less secure.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel className="pt-1">
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mb-3"
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setDisabling(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={disabling || !password}
                  onClick={() => void disable()}
                >
                  {disabling ? 'Working…' : 'Disable'}
                </Button>
              </div>
            </DialogPanel>
          </DialogPopup>
        </Dialog>
      ) : null}
    </section>
  )
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
      <TwoFactorSection />
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