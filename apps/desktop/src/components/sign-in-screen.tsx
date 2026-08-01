import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@loora/ui/button'
import { Spinner } from '@loora/ui/spinner'
import { startBrowserSignIn } from '#app/lib/desktop-host'

/**
 * Signing in happens in a browser, at loora.design.
 *
 * A window that asked for a password would be a window asking to be trusted
 * with one. This asks for nothing: it opens the account page in the browser
 * the account is probably already signed into, and the host process picks the
 * session up when it arrives — which is what ends this screen.
 */
export function SignInScreen() {
  const queryClient = useQueryClient()
  const [state, setState] = useState<'idle' | 'opening' | 'waiting'>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (state !== 'waiting') return
    const id = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ['desktop', 'session'] })
    }, 750)
    return () => window.clearInterval(id)
  }, [queryClient, state])

  const open = async () => {
    setState('opening')
    setError(null)
    try {
      await startBrowserSignIn()
      setState('waiting')
      void queryClient.invalidateQueries({ queryKey: ['desktop', 'session'] })
    } catch {
      setState('idle')
      setError('Could not open a browser. Open loora.design yourself and try again.')
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-cx-canvas p-6">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 text-center">
        <h1 className="text-base font-medium">Loora</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in at loora.design and this app picks the session up. It stays
          signed in until you sign out here.
        </p>
        <Button
          className="mt-5 w-full"
          disabled={state !== 'idle'}
          onClick={() => void open()}
        >
          {state === 'idle' ? null : <Spinner />}
          {state === 'waiting' ? 'Waiting for the browser…' : 'Sign in at loora.design'}
        </Button>
        {state === 'waiting' ? (
          <button
            type="button"
            className="mt-3 text-xs text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => setState('idle')}
          >
            Open it again
          </button>
        ) : null}
        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      </div>
    </main>
  )
}
