import { useState, type ReactNode } from 'react'
import { authClient } from '@loora/auth/client'
import { CanvasApp } from '#/components/canvas/app'
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
 */
export function AccountGate({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession()
  const [welcomeOpen, setWelcomeOpen] = useState(() => !hasSeenWelcome())

  if (isPending) {
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
