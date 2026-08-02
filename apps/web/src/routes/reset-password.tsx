import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { authClient } from '@loora/auth/client'
import { Button } from '@loora/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@loora/ui/dialog'
import { Input } from '@loora/ui/input'
import { seo } from '#/lib/seo'

type ResetPasswordSearch = {
  error?: string
  token?: string
}

export const Route = createFileRoute('/reset-password')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): ResetPasswordSearch => ({
    error: typeof search.error === 'string' ? search.error : undefined,
    token: typeof search.token === 'string' ? search.token : undefined,
  }),
  head: () =>
    seo({
      title: 'Reset password — Loora',
      description: 'Set a new password for your Loora account.',
      noindex: true,
    }),
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const { error: tokenError, token } = Route.useSearch()
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(
    tokenError || !token ? 'This password reset link is invalid or has expired.' : '',
  )
  const [complete, setComplete] = useState(false)

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogPopup className="max-w-sm" showCloseButton={false} bottomStickOnMobile={false}>
        <DialogHeader>
          <p className="mb-4 text-lg font-semibold tracking-tight">
            loora<span className="text-cx-accent">.</span>
          </p>
          <DialogTitle>{complete ? 'Password updated' : 'Choose a new password'}</DialogTitle>
          <DialogDescription>
            {complete
              ? 'Your new password is ready to use.'
              : 'Use at least eight characters for your new password.'}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="pt-1">
          {complete ? (
            <Button className="w-full" render={<a href="/" />}>
              Return to login
            </Button>
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={async (event) => {
                event.preventDefault()
                if (!token) return

                setPending(true)
                setError('')
                const result = await authClient.resetPassword({
                  newPassword: password,
                  token,
                })
                if (result.error) {
                  setError(result.error.message ?? 'Could not reset your password')
                } else {
                  setComplete(true)
                }
                setPending(false)
              }}
            >
              <Input
                aria-label="New password"
                autoComplete="new-password"
                disabled={!token}
                minLength={8}
                placeholder="New password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              {error && <p className="text-sm text-destructive-foreground">{error}</p>}
              <Button disabled={pending || !token} type="submit">
                {pending ? 'Updating…' : 'Update password'}
              </Button>
            </form>
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  )
}
