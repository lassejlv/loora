import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { authClient } from '@loora/auth/client'
import { Button } from '@loora/ui/button'
import { seo } from '#/lib/seo'

// OAuth consent screen for MCP clients (Claude Code, Codex, opencode, …).
// Better Auth redirects here with consent_code/client_id/scope query params;
// oauth2.consent finishes the authorize flow and hands back the redirect URI.
export const Route = createFileRoute('/mcp-consent')({
  ssr: false,
  head: () =>
    seo({
      title: 'Authorize — Loora',
      description: 'Approve an MCP client connection.',
      noindex: true,
    }),
  component: McpConsentPage,
})

const SCOPE_LABELS: Record<string, string> = {
  openid: 'Confirm your identity',
  profile: 'Read your name and avatar',
  email: 'Read your email address',
  offline_access: 'Stay connected without asking again',
}

function McpConsentPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const consentCode = params.get('consent_code')
  const clientId = params.get('client_id')
  const scopes = (params.get('scope') ?? '').split(/[\s+]+/).filter(Boolean)

  const [pending, setPending] = useState<'accept' | 'deny' | null>(null)
  const [error, setError] = useState('')

  async function respond(accept: boolean) {
    if (!consentCode) return
    setPending(accept ? 'accept' : 'deny')
    setError('')
    const result = await authClient.oauth2.consent({ accept, consent_code: consentCode })
    if (result.error) {
      setError(result.error.message ?? 'Something went wrong. Try connecting again.')
      setPending(null)
      return
    }
    const redirectURI = (result.data as { redirectURI?: string } | null)?.redirectURI
    if (redirectURI) window.location.href = redirectURI
    else setPending(null)
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm">
        <p className="mb-4 text-lg font-semibold tracking-tight">
          loora<span className="text-cx-accent">.</span>
        </p>

        {!consentCode ? (
          <>
            <h1 className="text-base font-semibold">Nothing to approve</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              This page finishes a connection request from an MCP client, but the request is
              missing or has expired. Start the connection again from your tool.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-base font-semibold">Allow access to your Loora account?</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {clientId ? (
                <>
                  An MCP client (<span className="font-mono text-xs">{clientId}</span>) wants to
                  connect.
                </>
              ) : (
                'An MCP client wants to connect.'
              )}{' '}
              It will be able to read and edit your designs, elements, version history, and
              assets as you.
            </p>

            {scopes.length > 0 && (
              <ul className="mt-4 space-y-1.5 rounded-lg border border-border bg-muted/40 p-3 text-sm">
                {scopes.map((scope) => (
                  <li key={scope} className="flex items-center gap-2">
                    <span aria-hidden="true" className="text-cx-accent">
                      •
                    </span>
                    {SCOPE_LABELS[scope] ?? scope}
                  </li>
                ))}
              </ul>
            )}

            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

            <div className="mt-5 flex gap-2">
              <Button
                className="flex-1"
                variant="outline"
                disabled={pending !== null}
                onClick={() => void respond(false)}
              >
                {pending === 'deny' ? 'Denying…' : 'Deny'}
              </Button>
              <Button
                className="flex-1"
                disabled={pending !== null}
                onClick={() => void respond(true)}
              >
                {pending === 'accept' ? 'Approving…' : 'Approve'}
              </Button>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
