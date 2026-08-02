import { useEffect, useRef, useState } from 'react'
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
import { Badge } from '@loora/ui/badge'
import { Button } from '@loora/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@loora/ui/dialog'
import { Input } from '@loora/ui/input'
import {
  OTPField,
  OTPFieldInput,
  OTPFieldSeparator,
} from '@loora/ui/otp-field'
import {
  CheckIcon,
  CopyIcon,
  PlusIcon,
  Trash2Icon,
} from '@loora/ui/icons'

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
  const [step, setStep] = useState<'idle' | 'password' | 'verify' | 'backup-codes'>('idle')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [totpUri, setTotpUri] = useState<string | null>(null)
  const [verifyCode, setVerifyCode] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)
  const [showManualCode, setShowManualCode] = useState(false)
  const [disabling, setDisabling] = useState(false)
  const [disablePassword, setDisablePassword] = useState('')
  const [copiedCode, setCopiedCode] = useState(false)
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    return () => clearTimeout(copyTimeout.current)
  }, [])

  function copySecret() {
    if (!totpUri) return
    void navigator.clipboard.writeText(totpUri).then(() => {
      setCopiedCode(true)
      clearTimeout(copyTimeout.current)
      copyTimeout.current = setTimeout(() => setCopiedCode(false), 1500)
    })
  }

  async function startEnroll() {
    setPending(true)
    setError(null)
    try {
      const { data, error: enableError } = await authClient.twoFactor.enable({
        password,
      })
      if (enableError) {
        setError(enableError.message ?? 'Could not enable 2FA.')
      } else if (data) {
        setTotpUri(data.totpURI ?? null)
        setBackupCodes(data.backupCodes ?? null)
        setStep('verify')
      }
    } catch {
      setError('Could not enable 2FA.')
    } finally {
      setPending(false)
    }
  }

  async function verifyTotp() {
    setPending(true)
    setError(null)
    try {
      const { error: verifyError } = await authClient.twoFactor.verifyTotp({
        code: verifyCode,
      })
      if (verifyError) {
        setError(verifyError.message ?? 'Verification failed.')
      } else {
        setStep('backup-codes')
      }
    } catch {
      setError('Verification failed.')
    } finally {
      setPending(false)
    }
  }

  function reset() {
    setStep('idle')
    setPassword('')
    setVerifyCode('')
    setTotpUri(null)
    setBackupCodes(null)
    setError(null)
    setShowManualCode(false)
  }

  async function disable2fa() {
    setPending(true)
    setError(null)
    try {
      const { error: disableError } = await authClient.twoFactor.disable({
        password: disablePassword,
      })
      if (disableError) {
        setError(disableError.message ?? 'Could not disable 2FA.')
      } else {
        setDisabling(false)
        setDisablePassword('')
        reset()
      }
    } catch {
      setError('Could not disable 2FA.')
    } finally {
      setPending(false)
    }
  }

  function done() {
    reset()
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Two-factor authentication</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Require a code from your authenticator app at sign-in.
          </p>
        </div>
        {enabled ? (
          <Badge variant="success" size="sm">On</Badge>
        ) : null}
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {enabled && step === 'idle' ? (
        <div className="flex items-center gap-2">
          <Button size="xs" variant="outline" onClick={() => setDisabling(true)}>
            Disable
          </Button>
        </div>
      ) : null}

      {!enabled && step === 'idle' ? (
        <Button size="sm" variant="outline" onClick={() => setStep('password')}>
          Enable
        </Button>
      ) : null}

      {step === 'password' ? (
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
          <p className="text-xs text-muted-foreground">
            Enter your password to begin.
          </p>
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && password) void startEnroll()
            }}
          />
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={reset}>
              Cancel
            </Button>
            <Button size="sm" disabled={pending || !password} onClick={() => void startEnroll()}>
              {pending ? 'Working…' : 'Continue'}
            </Button>
          </div>
        </div>
      ) : null}

      {step === 'verify' ? (
        <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4">
          <div className="flex flex-col items-center gap-3">
            {totpUri && !showManualCode ? (
              <>
                <div className="rounded-lg border border-line bg-white p-3">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=0&data=${encodeURIComponent(totpUri)}`}
                    alt="QR code"
                    width={160}
                    height={160}
                  />
                </div>
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  onClick={() => setShowManualCode(true)}
                >
                  Cannot scan QR?
                </button>
              </>
            ) : (
              <div className="flex w-full flex-col gap-2">
                <p className="text-xs text-muted-foreground">
                  Enter this code manually in your authenticator app:
                </p>
                <code className="block w-full break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">
                  {totpUri}
                </code>
                <button
                  type="button"
                  className="flex items-center gap-1 self-end text-xs text-muted-foreground hover:text-foreground"
                  onClick={copySecret}
                >
                  {copiedCode ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
                  {copiedCode ? 'Copied' : 'Copy'}
                </button>
                {showManualCode ? (
                  <button
                    type="button"
                    className="self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    onClick={() => setShowManualCode(false)}
                  >
                    Show QR code
                  </button>
                ) : null}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <p className="text-xs font-medium">Enter the 6-digit code</p>
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
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={reset}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={pending || verifyCode.length < 6}
              onClick={() => void verifyTotp()}
            >
              {pending ? 'Verifying…' : 'Verify'}
            </Button>
          </div>
        </div>
      ) : null}

      {step === 'backup-codes' && backupCodes ? (
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
          <div>
            <p className="text-sm font-medium">Save your backup codes</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Store these somewhere safe. Use them to sign in if you lose your
              authenticator. Each code works once.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md bg-muted p-3 font-mono text-xs">
            {backupCodes.map((code) => (
              <span key={code} className="select-all">{code}</span>
            ))}
          </div>
          <Button size="sm" className="self-end" onClick={done}>
            Done
          </Button>
        </div>
      ) : null}

      <Dialog open={disabling} onOpenChange={(open) => { setDisabling(open); if (!open) setDisablePassword('') }}>
        <DialogPopup className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Disable two-factor authentication?</DialogTitle>
            <DialogDescription>
              Enter your password to confirm. Your account will rely on your password alone.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="pt-1">
            <Input
              type="password"
              placeholder="Password"
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              className="mb-3"
            />
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setDisabling(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={pending || !disablePassword}
                onClick={() => void disable2fa()}
              >
                {pending ? 'Working…' : 'Disable'}
              </Button>
            </DialogFooter>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
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