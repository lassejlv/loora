import { useCallback, useEffect, useState } from 'react'
import { LogOutIcon } from '@loora/ui/icons'
import { clearWelcomeSeen } from './welcome-dialog'
import { authClient } from '@loora/auth/client'
import { orpc } from '@loora/rpc/client'
import { readAccessVerdict, writeAccessVerdict } from '../lib/access-cache'
import { Button } from '@loora/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@loora/ui/dialog'

interface PreviewAccessScreenProps {
  userId: string
  children: React.ReactNode
  preview: React.ReactNode
}

export function PreviewAccessScreen({ userId, children, preview }: PreviewAccessScreenProps) {
  const [status, setStatus] = useState<{ granted: boolean; requested: boolean } | null>(null)
  // Last load's verdict: lets a returning user mount the editor immediately
  // while the check re-runs in the background. A live "revoked" result wins.
  const [optimistic] = useState(() => readAccessVerdict('preview', userId))
  const [pending, setPending] = useState(true)
  const [error, setError] = useState('')

  const loadStatus = useCallback(async () => {
    setPending(true)
    setError('')
    try {
      const next = await orpc.auth.previewAccess()
      setStatus({ granted: next.granted, requested: next.requested })
      writeAccessVerdict('preview', userId, next.granted)
    } catch {
      setError('Could not check preview access. Please try again.')
    } finally {
      setPending(false)
    }
  }, [userId])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  if (status ? status.granted : optimistic) return children

  // First-ever check in flight: hold the same shimmer the session check shows
  // instead of flashing the request dialog at users who have access.
  if (status === null && !error) {
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
            <DialogTitle>Request access to Loora Preview</DialogTitle>
            <DialogDescription>
              Loora is currently in a limited preview. Request access and we’ll review your account.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-3 pt-1">
            {status?.requested ? (
              <p className="rounded-md bg-secondary px-3 py-2 text-sm text-secondary-foreground">
                Your request has been received.
              </p>
            ) : null}
            {error ? <p className="text-sm text-destructive-foreground">{error}</p> : null}
            {status?.requested ? (
              <Button variant="outline" disabled={pending} onClick={() => void loadStatus()}>
                Check access
              </Button>
            ) : (
              <Button
                disabled={pending}
                onClick={async () => {
                  if (status === null) {
                    await loadStatus()
                    return
                  }
                  setPending(true)
                  setError('')
                  try {
                    const next = await orpc.auth.requestPreviewAccess()
                    setStatus({ granted: next.granted, requested: next.requested })
                  } catch {
                    setError('Could not send your request. Please try again.')
                  } finally {
                    setPending(false)
                  }
                }}
              >
                {pending
                  ? status === null
                    ? 'Checking access…'
                    : 'Requesting…'
                  : status === null
                    ? 'Try again'
                    : 'Request Access to Preview'}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => {
                clearWelcomeSeen()
                void authClient.signOut()
              }}
            >
              <LogOutIcon data-slot="icon" />
              Sign out
            </Button>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  )
}
