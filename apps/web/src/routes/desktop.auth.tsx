import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { authClient } from '@loora/auth/client'
import { AuthScreen } from '@loora/shell/auth-screen'
import { Button } from '@loora/ui/button'
import { Spinner } from '@loora/ui/spinner'

/**
 * Where the desktop app sends a browser to sign in.
 *
 * The app never sees a password: it opens this page with the loopback port it
 * is listening on, the visitor signs in here as they would anywhere else, and
 * one press mints a single-use code that goes back to `127.0.0.1` — never
 * anywhere else, because the port is all this page is allowed to send to. The
 * app trades the code for the session and keeps it out of its own window.
 */

function validPort(value: unknown) {
  const port = Number(value)
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : null
}

function validState(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(value)
    ? value
    : null
}

export const Route = createFileRoute('/desktop/auth')({
  component: DesktopAuthPage,
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    port: validPort(search.port),
    state: validState(search.state),
  }),
})

function DesktopAuthPage() {
  const { port, state } = Route.useSearch()
  const { data: session, isPending } = authClient.useSession()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [handedOver, setHandedOver] = useState(false)

  if (!port || !state) {
    return (
      <Frame title="Nothing to connect">
        <p className="text-sm text-muted-foreground">
          Open Loora for desktop and choose “Sign in” there. This page only
          works from a link the app opens itself.
        </p>
      </Frame>
    )
  }

  if (isPending) {
    return (
      <Frame title="Loora for desktop">
        <p className="cx-shimmer text-sm">Checking your account…</p>
      </Frame>
    )
  }

  if (!session) return <AuthScreen />

  if (handedOver) {
    return (
      <Frame title="You're signed in">
        <p className="text-sm text-muted-foreground">
          Loora for desktop has your account. You can close this tab.
        </p>
      </Frame>
    )
  }

  const connect = async () => {
    setBusy(true)
    setError(null)
    const result = await authClient.oneTimeToken.generate()
    const token = result.data?.token
    if (!token) {
      setBusy(false)
      setError('Could not start the hand-off. Try again.')
      return
    }
    setHandedOver(true)
    const callback = new URL(`http://127.0.0.1:${port}/callback`)
    callback.searchParams.set('token', token)
    callback.searchParams.set('state', state)
    window.location.replace(callback.toString())
  }

  return (
    <Frame title="Connect Loora for desktop">
      <p className="text-sm text-muted-foreground">
        Signing in as <span className="text-foreground">{session.user.email}</span>.
        The app on this computer will hold this session until you sign out of it.
      </p>
      <Button className="mt-5 w-full" disabled={busy} onClick={() => void connect()}>
        {busy ? <Spinner /> : null}
        {busy ? 'Connecting…' : 'Connect'}
      </Button>
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
    </Frame>
  )
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-cx-canvas p-6">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6">
        <h1 className="text-base font-medium">{title}</h1>
        <div className="mt-2">{children}</div>
      </div>
    </main>
  )
}
