import { useCallback, useEffect, useState } from 'react'
import { LogOutIcon } from 'lucide-react'
import { authClient } from '@loora/auth/client'
import { orpc } from '#/lib/orpc-client'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '#/components/ui/dialog'

interface PreviewAccessScreenProps {
  children: React.ReactNode
  preview: React.ReactNode
}

export function PreviewAccessScreen({ children, preview }: PreviewAccessScreenProps) {
  const [status, setStatus] = useState<{ granted: boolean; requested: boolean } | null>(null)
  const [pending, setPending] = useState(true)
  const [error, setError] = useState('')

  const loadStatus = useCallback(async () => {
    setPending(true)
    setError('')
    try {
      const next = await orpc.auth.previewAccess()
      setStatus({ granted: next.granted, requested: next.requested })
    } catch {
      setError('Could not check preview access. Please try again.')
    } finally {
      setPending(false)
    }
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  if (status?.granted) return children

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
            <Button variant="ghost" onClick={() => authClient.signOut()}>
              <LogOutIcon data-slot="icon" />
              Sign out
            </Button>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  )
}
