import { useEffect, useState } from 'react'
import {
  CheckIcon,
  GithubIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
} from '#/components/icons'
import { ExternalLinkIcon, UnplugIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { orpc } from '#/lib/orpc-client'

type GitHubStatus = Awaited<ReturnType<typeof orpc.github.status>>

export function GitHubAccount() {
  const [status, setStatus] = useState<GitHubStatus | null>(null)
  const [error, setError] = useState('')
  const [notice] = useState(() => {
    if (typeof window === 'undefined') return ''
    const result = new URLSearchParams(window.location.search).get('github')
    if (result === 'connected') return 'GitHub access is connected.'
    if (result === 'cancelled') return 'GitHub connection was cancelled.'
    if (result === 'unavailable') return 'GitHub access is not configured on this server.'
    if (result === 'failed') return 'GitHub could not be connected. Check the app settings and try again.'
    return ''
  })
  const [refreshing, setRefreshing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const load = async () => {
    try {
      setStatus(await orpc.github.status())
      setError('')
    } catch {
      setError('Could not load the GitHub connection.')
    }
  }

  useEffect(() => {
    void load()
    const url = new URL(window.location.href)
    if (url.searchParams.has('github')) {
      url.searchParams.delete('github')
      url.searchParams.delete('settings')
      window.history.replaceState(window.history.state, '', url)
    }
  }, [])

  if (!status && !error) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <LoaderCircleIcon className="size-3.5 animate-spin" />
        Checking GitHub connection…
      </div>
    )
  }

  if (!status) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-4">
        <p className="text-xs text-destructive-foreground">{error}</p>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    )
  }

  if (!status.enabled) {
    return (
      <div className="rounded-xl border border-border p-4 text-xs text-muted-foreground">
        GitHub access is not configured on this Loora server.
      </div>
    )
  }

  if (!status.connected) {
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-border p-4">
        <div className="flex items-start gap-3">
          <div className="flex size-9 items-center justify-center rounded-full bg-foreground text-background">
            <GithubIcon className="size-4" />
          </div>
          <div>
            <p className="text-sm font-medium">Connect GitHub</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Give Loora read-only access to repositories you choose. Relevant source files and images may be sent to your selected AI provider when the agent inspects them.
            </p>
          </div>
        </div>
        <Button size="sm" className="w-fit" onClick={() => window.location.assign('/api/github/connect')}>
          <GithubIcon data-slot="icon" />
          Connect GitHub
        </Button>
        {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
        {error ? <p className="text-xs text-destructive-foreground">{error}</p> : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 rounded-xl border border-border p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
            <CheckIcon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">GitHub connected</p>
            <p className="truncate text-xs text-muted-foreground">@{status.account.login}</p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {status.installations.length === 0 ? (
            <p className="text-xs text-muted-foreground">No repository installations are connected yet.</p>
          ) : (
            status.installations.map((installation) => (
              <div key={installation.id} className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{installation.login}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {installation.suspendedAt
                      ? 'Access suspended'
                      : installation.repositorySelection === 'all'
                        ? 'All repositories'
                        : 'Selected repositories'}
                  </p>
                </div>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {installation.type}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => window.location.assign('/api/github/install')}>
            <PlusIcon data-slot="icon" />
            Add repositories
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true)
              setError('')
              try {
                await orpc.github.refresh()
                await load()
              } catch {
                setError('Could not refresh GitHub access. Reconnect if the problem continues.')
              } finally {
                setRefreshing(false)
              }
            }}
          >
            <RefreshCwIcon className={refreshing ? 'animate-spin' : ''} data-slot="icon" />
            Refresh
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => window.open('https://github.com/settings/installations', '_blank', 'noopener,noreferrer')}
          >
            <ExternalLinkIcon data-slot="icon" />
            Manage on GitHub
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Loora cannot write to repositories. Disconnecting here does not uninstall the GitHub App.
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={disconnecting}
          onClick={async () => {
            if (!window.confirm('Disconnect GitHub from Loora? Repository selections will be cleared.')) return
            setDisconnecting(true)
            try {
              await orpc.github.disconnect()
              await load()
            } catch {
              setError('Could not disconnect GitHub.')
            } finally {
              setDisconnecting(false)
            }
          }}
        >
          <UnplugIcon data-slot="icon" />
          Disconnect
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive-foreground">{error}</p> : null}
      {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
    </div>
  )
}
