import { useState, type ReactNode } from 'react'
import { authClient } from '@loora/auth/client'
import { CanvasV2App } from '#/components/canvas-v2/app'
import { AuthScreen } from '#/components/auth-screen'
import { PreviewAccessScreen } from '#/components/preview-access-screen'
import { SubscriptionScreen } from '#/components/subscription-screen'
import {
  WelcomeDialog,
  hasSeenWelcome,
  markWelcomeSeen,
} from '#/components/welcome-dialog'

/**
 * Session, preview access, and billing gates for every signed-in surface.
 * Both `/app` and `/app/design` mount their content through this so the gates
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
          <CanvasV2App preview />
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
    <PreviewAccessScreen
      userId={session.user.id}
      preview={<CanvasV2App preview />}
    >
      <SubscriptionScreen
        userId={session.user.id}
        preview={<CanvasV2App preview />}
      >
        {children}
      </SubscriptionScreen>
    </PreviewAccessScreen>
  )
}
