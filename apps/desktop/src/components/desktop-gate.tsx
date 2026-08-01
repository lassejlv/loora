import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AccountGate } from '@loora/shell/account-gate'
import { readHostSession } from '#app/lib/desktop-host'
import { SignInScreen } from '#app/components/sign-in-screen'

/**
 * Two gates, in order.
 *
 * The host process either holds a session or it does not, and only it knows —
 * so that answer comes first, and it is polled while a browser is being waited
 * on. Everything after that is the same gate the web app runs: legal consent,
 * preview access, plan.
 */
export function DesktopGate({
  children,
  designId,
}: {
  children: ReactNode
  designId?: string
}) {
  const session = useQuery({
    queryKey: ['desktop', 'session'],
    queryFn: readHostSession,
    // Once signed in there is nothing to wait for; before that, the browser
    // may hand a session over at any moment.
    refetchInterval: (query) => (query.state.data?.signedIn ? false : 1_000),
    refetchOnWindowFocus: true,
  })

  if (session.isPending) {
    return (
      <main className="grid min-h-screen place-items-center bg-cx-canvas">
        <p className="cx-shimmer text-sm">Opening Loora…</p>
      </main>
    )
  }

  if (!session.data?.signedIn) return <SignInScreen />

  return (
    <AccountGate designId={designId} renderSignedOut={() => <SignInScreen />}>
      {children}
    </AccountGate>
  )
}
