import { useState } from 'react'
import { authClient } from '#/lib/auth-client'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'

export function AuthScreen() {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  return (
    <main className="grid min-h-screen place-items-center bg-cx-canvas p-6">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-sm">
        <div className="mb-6">
          <p className="text-lg font-semibold tracking-tight">
            loora<span className="text-cx-accent">.</span>
          </p>
          <h1 className="mt-6 text-2xl font-semibold">
            {mode === 'sign-in' ? 'Welcome back' : 'Create your account'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === 'sign-in' ? 'Sign in to open your canvas.' : 'Start designing with your own workspace.'}
          </p>
        </div>

        <form
          className="flex flex-col gap-3"
          onSubmit={async (event) => {
            event.preventDefault()
            setPending(true)
            setError('')

            const result =
              mode === 'sign-in'
                ? await authClient.signIn.email({ email, password })
                : await authClient.signUp.email({ name, email, password })

            if (result.error) setError(result.error.message ?? 'Authentication failed')
            setPending(false)
          }}
        >
          {mode === 'sign-up' && (
            <Input
              aria-label="Name"
              autoComplete="name"
              placeholder="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          )}
          <Input
            aria-label="Email"
            autoComplete="email"
            placeholder="you@example.com"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <Input
            aria-label="Password"
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            minLength={8}
            placeholder="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {error && <p className="text-sm text-destructive-foreground">{error}</p>}
          <Button className="mt-1" disabled={pending} type="submit">
            {pending ? 'Working…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
          </Button>
        </form>

        <button
          className="mt-5 w-full text-center text-sm text-muted-foreground hover:text-foreground"
          type="button"
          onClick={() => {
            setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')
            setError('')
          }}
        >
          {mode === 'sign-in' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
        </button>
      </div>
    </main>
  )
}
