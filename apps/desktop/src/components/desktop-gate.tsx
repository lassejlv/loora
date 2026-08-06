import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AccountGate } from '@loora/shell/account-gate'
import { readHostSession } from '#app/lib/desktop-host'
import { SignInScreen } from '#app/components/sign-in-screen'

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
    staleTime: 0,
    refetchInterval: (query) => (query.state.data?.signedIn ? 5_000 : 750),
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
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
