import { useEffect, useState } from 'react'
import {
  ExternalLinkIcon,
  GithubIcon,
  PlusIcon,
  RefreshCwIcon,
} from '@loora/ui/icons'
import { UnplugIcon } from '@loora/ui/icons'
import { Button } from '@loora/ui/button'
import { IntegrationCard, IntegrationStatus } from '#/components/integration-card'
import { orpc } from '@loora/rpc/client'

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
    // Clear only the one-shot OAuth result flag; keep the selected integration.
    const url = new URL(window.location.href)
    if (url.searchParams.has('github')) {
      url.searchParams.delete('github')
      window.history.replaceState(window.history.state, '', url)
    }
  }, [])

  if (!status && !error) {
    return (
      <IntegrationCard
        title="GitHub"
        status={<IntegrationStatus>Checking…</IntegrationStatus>}
        description="Loading connection status…"
      />
    )
  }

  if (!status) {
    return (
      <IntegrationCard
        title="GitHub"
        status={<IntegrationStatus tone="warning">Error</IntegrationStatus>}
        description={error}
      >
        <Button size="sm" variant="outline" className="w-fit" onClick={() => void load()}>
          Try again
        </Button>
      </IntegrationCard>
    )
  }

  if (!status.enabled) {
    return (
      <IntegrationCard
        title="GitHub"
        status={<IntegrationStatus>Unavailable</IntegrationStatus>}
        description="GitHub access is not configured on this Loora server."
      />
    )
  }

  if (!status.connected) {
    return (
      <IntegrationCard
        title="GitHub"
        status={<IntegrationStatus>Not connected</IntegrationStatus>}
        description="Give Loora read-only access to repositories you choose. Relevant source files and images may be sent to your selected AI provider when the agent inspects them."
      >
        <Button size="sm" className="w-fit" onClick={() => window.location.assign('/api/github/connect')}>
          <GithubIcon data-slot="icon" />
          Connect GitHub
        </Button>
        {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
        {error ? <p className="text-xs text-destructive-foreground">{error}</p> : null}
      </IntegrationCard>
    )
  }

  return (
    <IntegrationCard
      title="GitHub"
      status={<IntegrationStatus tone="success">Connected</IntegrationStatus>}
      description={
        <span className="block truncate">
          @{status.account.login}
          {status.installations.length > 0
            ? ` · ${status.installations.length} installation${status.installations.length === 1 ? '' : 's'}`
            : ''}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        {status.installations.length === 0 ? (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            No repository installations are connected yet.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {status.installations.map((installation) => (
              <div
                key={installation.id}
                className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{installation.login}</p>
                  <p className="text-xs text-muted-foreground">
                    {installation.suspendedAt
                      ? 'Access suspended'
                      : installation.repositorySelection === 'all'
                        ? 'All repositories'
                        : 'Selected repositories'}
                  </p>
                </div>
                <span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
                  {installation.type}
                </span>
              </div>
            ))}
          </div>
        )}

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
            onClick={() =>
              window.open('https://github.com/settings/installations', '_blank', 'noopener,noreferrer')
            }
          >
            <ExternalLinkIcon data-slot="icon" />
            Manage on GitHub
          </Button>
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Loora cannot write to repositories. Disconnecting here does not uninstall the GitHub App.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="w-fit shrink-0"
            disabled={disconnecting}
            onClick={async () => {
              if (!window.confirm('Disconnect GitHub from Loora? Repository selections will be cleared.')) {
                return
              }
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
    </IntegrationCard>
  )
}
