import { useEffect, useState, type ReactNode } from 'react'
import { authClient } from '@loora/auth/client'
import { orpc } from '@loora/rpc/client'
import { readAccessVerdict, writeAccessVerdict } from '#/lib/access-cache'
import { CanvasApp } from '@loora/editor/app'
import { AuthScreen } from '#/components/auth-screen'
import { PreviewAccessScreen } from '#/components/preview-access-screen'
import { SubscriptionScreen } from '#/components/subscription-screen'
import { LegalConsentScreen } from '#/components/legal-consent-screen'
import {
  WelcomeDialog,
  hasSeenWelcome,
  markWelcomeSeen,
} from '#/components/welcome-dialog'

/**
 * Session, preview access, and billing gates for every signed-in surface.
 * Both `/app` and `/design/$id` mount their content through this so the gates
 * behave identically wherever a link drops the visitor.
 *
 * `designId` marks a surface that somebody may have been invited into. A guest
 * works under the owner's plan, so the preview and subscription gates do not
 * apply to them — being asked to subscribe before you can look at a document
 * someone shared with you would make an invitation worthless. Their own files
 * are still gated normally, because `/app` passes no design.
 */
export function AccountGate({
  children,
  designId,
}: {
  children: ReactNode
  designId?: string
}) {
  const { data: session, isPending } = authClient.useSession()
  const [hasResolvedSession, setHasResolvedSession] = useState(() => !isPending)
  const [welcomeOpen, setWelcomeOpen] = useState(() => !hasSeenWelcome())
  const userId = session?.user.id
  const gateKey = designId ? `share:${designId}` : ''
  // A returning guest skips straight in on the cached verdict; the server
  // re-checks on every request either way, so a stale yes only ever shows UI.
  const [guest, setGuest] = useState(() =>
    gateKey && userId ? readAccessVerdict(gateKey, userId) : false,
  )

  useEffect(() => {
    if (!isPending) setHasResolvedSession(true)
  }, [isPending])

  useEffect(() => {
    if (!designId || !userId) return
    let cancelled = false
    void orpc.share
      .get({ designId })
      .then((state) => {
        if (cancelled) return
        const invited = state.role !== 'owner'
        setGuest(invited)
        writeAccessVerdict(`share:${designId}`, userId, invited)
      })
      .catch(() => {
        if (!cancelled) setGuest(false)
      })
    return () => {
      cancelled = true
    }
  }, [designId, userId])

  if (isPending && !hasResolvedSession) {
    return (
      <main className="grid min-h-screen place-items-center bg-cx-canvas">
        <p className="cx-shimmer text-sm">Opening your canvas…</p>
      </main>
    )
  }

  if (!session) {
    return (
      <>
        <div
          aria-hidden="true"
          className="pointer-events-none select-none"
          inert
        >
          <CanvasApp preview />
        </div>
        {welcomeOpen ? (
          <WelcomeDialog
            open
            onOpenChange={(open) => {
              if (!open) {
                markWelcomeSeen()
                setWelcomeOpen(false)
              }
            }}
          />
        ) : (
          <AuthScreen />
        )}
      </>
    )
  }

  if (guest) {
    return (
      <LegalConsentScreen preview={<CanvasApp preview />}>
        {children}
      </LegalConsentScreen>
    )
  }

  return (
    <LegalConsentScreen preview={<CanvasApp preview />}>
      <PreviewAccessScreen
        userId={session.user.id}
        preview={<CanvasApp preview />}
      >
        <SubscriptionScreen
          userId={session.user.id}
          preview={<CanvasApp preview />}
        >
          {children}
        </SubscriptionScreen>
      </PreviewAccessScreen>
    </LegalConsentScreen>
  )
}
