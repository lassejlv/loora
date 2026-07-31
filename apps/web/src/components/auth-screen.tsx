import { useEffect, useState } from 'react'
import { authClient } from '@loora/auth/client'
import { orpc } from '#/lib/orpc-client'
import { Button } from '@loora/ui/button'
import { Checkbox } from '@loora/ui/checkbox'
import { Input } from '@loora/ui/input'
import { Label } from '@loora/ui/label'
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@loora/ui/dialog'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@loora/ui/tabs'
import {
  clearPendingLegalConsent,
  markPendingLegalConsent,
} from '#/lib/pending-legal-consent'

export function AuthScreen() {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [acceptedLegal, setAcceptedLegal] = useState(false)
  const [forgotPassword, setForgotPassword] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [googleOAuthEnabled, setGoogleOAuthEnabled] = useState(false)

  useEffect(() => {
    clearPendingLegalConsent()
    let cancelled = false
    orpc.auth
      .config()
      .then((config) => {
        if (!cancelled) setGoogleOAuthEnabled(config.googleOAuthEnabled)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return (
      <Dialog open onOpenChange={() => {}}>
        <DialogPopup className="max-w-sm" showCloseButton={false} bottomStickOnMobile={false}>
          <DialogHeader>
            <p className="mb-4 text-lg font-semibold tracking-tight">
              loora<span className="text-cx-accent">.</span>
            </p>
            <DialogTitle>
              {forgotPassword
                ? 'Reset your password'
                : mode === 'sign-in'
                  ? 'Welcome back'
                  : 'Create your account'}
            </DialogTitle>
            <DialogDescription>
              {forgotPassword
                ? 'We will send a secure reset link if an account exists.'
                : mode === 'sign-in'
                ? 'Sign in to open your canvas.'
                : 'Start designing with your own workspace.'}
            </DialogDescription>
          </DialogHeader>

          <DialogPanel className="pt-1">
            <Tabs
              value={mode}
              onValueChange={(value) => {
                setMode(value as 'sign-in' | 'sign-up')
                setForgotPassword(false)
                setError('')
                setNotice('')
              }}
            >
              {!forgotPassword && (
                <TabsList className="mb-4 grid w-full grid-cols-2 rounded-lg p-1">
                  <TabsTab value="sign-in">Login</TabsTab>
                  <TabsTab value="sign-up">Sign up</TabsTab>
                </TabsList>
              )}
              <TabsPanel value={mode}>
                <form
                  className="flex flex-col gap-3"
                  onSubmit={async (event) => {
                    event.preventDefault()
                    setPending(true)
                    setError('')
                    setNotice('')

                    const result = forgotPassword
                      ? await authClient.requestPasswordReset({
                          email,
                          redirectTo: '/reset-password',
                        })
                      : mode === 'sign-in'
                        ? await authClient.signIn.email({ email, password })
                        : await authClient.signUp.email({
                            name,
                            email,
                            password,
                            acceptedTerms: acceptedLegal,
                            acceptedPrivacy: acceptedLegal,
                          })

                    if (result.error) setError(result.error.message ?? 'Authentication failed')
                    else if (forgotPassword) {
                      setNotice('Check your inbox for a password reset link.')
                    } else if (mode === 'sign-up') {
                      setNotice('Check your inbox to verify your email and finish signing up.')
                      setPassword('')
                    }
                    setPending(false)
                  }}
                >
                  {mode === 'sign-up' && !forgotPassword && (
                    <Input
                      aria-label="Name"
                      autoComplete="name"
                      placeholder="Name"
                      className="rounded-lg"
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
                    className="rounded-lg"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                  {!forgotPassword && (
                    <Input
                      aria-label="Password"
                      autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                      minLength={8}
                      placeholder="Password"
                      type="password"
                      className="rounded-lg"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                    />
                  )}
                  {mode === 'sign-up' && !forgotPassword && (
                    <Label className="items-start gap-2 py-1 text-xs leading-5">
                      <Checkbox
                        aria-label="Accept Terms of Service and Privacy Policy"
                        checked={acceptedLegal}
                        onCheckedChange={(checked) => setAcceptedLegal(checked === true)}
                      />
                      <span>
                        I accept the{' '}
                        <a
                          className="underline underline-offset-2"
                          href="/terms"
                          rel="noreferrer"
                          target="_blank"
                        >
                          Terms of Service
                        </a>{' '}
                        and acknowledge the{' '}
                        <a
                          className="underline underline-offset-2"
                          href="/privacy"
                          rel="noreferrer"
                          target="_blank"
                        >
                          Privacy Policy
                        </a>
                        .
                      </span>
                    </Label>
                  )}
                  {error && <p className="text-sm text-destructive-foreground">{error}</p>}
                  {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
                  <Button
                    className="mt-1 rounded-lg"
                    disabled={pending || (mode === 'sign-up' && !acceptedLegal)}
                    type="submit"
                  >
                    {pending
                      ? 'Working…'
                      : forgotPassword
                        ? 'Send reset link'
                        : mode === 'sign-in'
                          ? 'Login'
                          : 'Create account'}
                  </Button>
                  {mode === 'sign-in' && (
                    <Button
                      className="self-center"
                      type="button"
                      variant="link"
                      onClick={() => {
                        setForgotPassword((value) => !value)
                        setError('')
                        setNotice('')
                      }}
                    >
                      {forgotPassword ? 'Back to login' : 'Forgot password?'}
                    </Button>
                  )}
                </form>
                {googleOAuthEnabled && !forgotPassword ? (
                  <>
                    <div className="my-4 flex items-center gap-3" aria-hidden="true">
                      <span className="h-px flex-1 bg-border" />
                      <span className="text-xs text-muted-foreground">or</span>
                      <span className="h-px flex-1 bg-border" />
                    </div>
                    <Button
                      className="w-full"
                      disabled={pending || (mode === 'sign-up' && !acceptedLegal)}
                      type="button"
                      variant="outline"
                      onClick={async () => {
                        setPending(true)
                        setError('')
                        try {
                          if (mode === 'sign-up') markPendingLegalConsent()
                          const result = await authClient.signIn.social({
                            provider: 'google',
                            callbackURL: '/',
                          })
                          if (result.error) {
                            setError(result.error.message ?? 'Google authentication failed')
                          }
                        } catch {
                          setError('Google authentication failed')
                        } finally {
                          setPending(false)
                        }
                      }}
                    >
                      Continue with Google
                    </Button>
                  </>
                ) : null}
              </TabsPanel>
            </Tabs>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
  )
}
