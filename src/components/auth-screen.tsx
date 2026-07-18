import { useState } from 'react'
import { authClient } from '#/lib/auth-client'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '#/components/ui/dialog'
import { Tabs, TabsList, TabsPanel, TabsTab } from '#/components/ui/tabs'

export function AuthScreen() {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  return (
    <main className="min-h-screen bg-cx-canvas">
      <Dialog open onOpenChange={() => {}}>
        <DialogPopup className="max-w-sm" showCloseButton={false} bottomStickOnMobile={false}>
          <DialogHeader>
            <p className="mb-4 text-lg font-semibold tracking-tight">
              loora<span className="text-cx-accent">.</span>
            </p>
            <DialogTitle>{mode === 'sign-in' ? 'Welcome back' : 'Create your account'}</DialogTitle>
            <DialogDescription>
              {mode === 'sign-in'
                ? 'Sign in to open your canvas.'
                : 'Start designing with your own workspace.'}
            </DialogDescription>
          </DialogHeader>

          <DialogPanel className="pt-1">
            <Tabs
              value={mode}
              onValueChange={(value) => {
                setMode(value as 'sign-in' | 'sign-up')
                setError('')
              }}
            >
              <TabsList className="mb-4 grid w-full grid-cols-2">
                <TabsTab value="sign-in">Login</TabsTab>
                <TabsTab value="sign-up">Sign up</TabsTab>
              </TabsList>
              <TabsPanel value={mode}>
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
                    {pending ? 'Working…' : mode === 'sign-in' ? 'Login' : 'Create account'}
                  </Button>
                </form>
              </TabsPanel>
            </Tabs>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </main>
  )
}
