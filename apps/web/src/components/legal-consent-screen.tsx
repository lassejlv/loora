import { useCallback, useEffect, useState } from 'react'
import { LogOutIcon } from '@loora/ui/icons'
import { authClient } from '@loora/auth/client'
import { orpc } from '#/lib/orpc-client'
import { Button } from '@loora/ui/button'
import { Checkbox } from '@loora/ui/checkbox'
import { Label } from '@loora/ui/label'
import {
  clearPendingLegalConsent,
  hasPendingLegalConsent,
} from '#/lib/pending-legal-consent'
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@loora/ui/dialog'

interface LegalConsentScreenProps {
  children: React.ReactNode
  preview: React.ReactNode
}

export function LegalConsentScreen({ children, preview }: LegalConsentScreenProps) {
  const [accepted, setAccepted] = useState<boolean | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [pending, setPending] = useState(true)
  const [error, setError] = useState('')

  const loadStatus = useCallback(async () => {
    setPending(true)
    setError('')
    try {
      const status = await orpc.auth.legalConsent()
      if (!status.accepted && hasPendingLegalConsent()) {
        const result = await orpc.auth.acceptLegal({
          acceptedTerms: true,
          acceptedPrivacy: true,
        })
        clearPendingLegalConsent()
        setAccepted(result.accepted)
      } else {
        if (status.accepted) clearPendingLegalConsent()
        setAccepted(status.accepted)
      }
    } catch {
      setError('Could not check your legal agreement. Please try again.')
    } finally {
      setPending(false)
    }
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  if (accepted === true) return children

  if (accepted === null && !error) {
    return (
      <main className="grid min-h-screen place-items-center bg-cx-canvas">
        <p className="cx-shimmer text-sm">Opening your canvas…</p>
      </main>
    )
  }

  return (
    <>
      <div aria-hidden="true" className="pointer-events-none select-none" inert>
        {preview}
      </div>
      <Dialog open onOpenChange={() => {}}>
        <DialogPopup className="max-w-sm" showCloseButton={false} bottomStickOnMobile={false}>
          <DialogHeader>
            <p className="mb-4 text-lg font-semibold tracking-tight">
              loora<span className="text-cx-accent">.</span>
            </p>
            <DialogTitle>Before you continue</DialogTitle>
            <DialogDescription>
              Please review and accept Loora’s current legal documents to keep using the service.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-3 pt-1">
            <Label className="items-start gap-2 rounded-lg border border-border p-3 text-xs leading-5">
              <Checkbox
                aria-label="Accept Terms of Service and Privacy Policy"
                checked={confirmed}
                onCheckedChange={(checked) => setConfirmed(checked === true)}
              />
              <span>
                I accept the{' '}
                <a
                  className="underline underline-offset-2"
                  href="/terms"
                  rel="noreferrer"
                  target="_blank"
                >
                  Terms of Service
                </a>{' '}
                and acknowledge the{' '}
                <a
                  className="underline underline-offset-2"
                  href="/privacy"
                  rel="noreferrer"
                  target="_blank"
                >
                  Privacy Policy
                </a>
                .
              </span>
            </Label>
            {error ? <p className="text-sm text-destructive-foreground">{error}</p> : null}
            <Button
              disabled={pending || !confirmed}
              onClick={async () => {
                if (accepted === null) {
                  await loadStatus()
                  return
                }
                setPending(true)
                setError('')
                try {
                  const result = await orpc.auth.acceptLegal({
                    acceptedTerms: true,
                    acceptedPrivacy: true,
                  })
                  clearPendingLegalConsent()
                  setAccepted(result.accepted)
                } catch {
                  setError('Could not save your agreement. Please try again.')
                } finally {
                  setPending(false)
                }
              }}
            >
              {pending ? 'Saving…' : 'Accept and continue'}
            </Button>
            <Button variant="ghost" onClick={() => void authClient.signOut()}>
              <LogOutIcon data-slot="icon" />
              Sign out
            </Button>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  )
}
