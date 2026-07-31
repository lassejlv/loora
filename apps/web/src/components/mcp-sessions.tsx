import { useEffect, useRef, useState } from 'react'
import { UnplugIcon } from '@loora/ui/icons'
import { CheckIcon, CopyIcon, RefreshCwIcon } from '@loora/ui/icons'
import { Button } from '@loora/ui/button'
import { IntegrationCard, IntegrationStatus } from '#/components/integration-card'
import { orpc } from '#/lib/orpc-client'

type McpSession = Awaited<ReturnType<typeof orpc.mcp.sessions>>[number]

const MCP_SERVER_URL = 'https://mcp.loora.design/mcp'

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp)
}

export function McpSessions() {
  const [sessions, setSessions] = useState<McpSession[] | null>(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const load = async () => {
    try {
      setSessions(await orpc.mcp.sessions())
      setError('')
    } catch {
      setError('Could not load MCP sessions.')
    }
  }

  useEffect(() => {
    void load()
    return () => clearTimeout(copyTimeout.current)
  }, [])

  if (!sessions && !error) {
    return (
      <IntegrationCard
        title="MCP"
        status={<IntegrationStatus>Checking…</IntegrationStatus>}
        description="Loading connected clients…"
      />
    )
  }

  const count = sessions?.length ?? 0
  const statusLabel =
    count === 0 ? 'None' : `${count} client${count === 1 ? '' : 's'}`

  return (
    <IntegrationCard
      title="MCP"
      status={
        <IntegrationStatus tone={count > 0 ? 'success' : 'neutral'}>
          {statusLabel}
        </IntegrationStatus>
      }
      description="Connect Claude Code, Codex, and other MCP clients to read and update your designs."
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 font-mono text-xs">
            {MCP_SERVER_URL}
          </code>
          <Button
            variant="outline"
            size="icon-sm"
            className="shrink-0"
            aria-label="Copy MCP server URL"
            onClick={async () => {
              await navigator.clipboard.writeText(MCP_SERVER_URL)
              setCopied(true)
              clearTimeout(copyTimeout.current)
              copyTimeout.current = setTimeout(() => setCopied(false), 1500)
            }}
          >
            {copied ? <CheckIcon data-slot="icon" /> : <CopyIcon data-slot="icon" />}
          </Button>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Clients authorize through loora.design and talk to the remote MCP server.
          </p>
          <Button
            size="icon-sm"
            variant="ghost"
            className="shrink-0"
            aria-label="Refresh MCP sessions"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true)
              await load()
              setRefreshing(false)
            }}
          >
            <RefreshCwIcon className={refreshing ? 'animate-spin' : ''} />
          </Button>
        </div>

        {count === 0 ? (
          <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            No MCP clients are connected.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {sessions?.map((session) => (
              <div
                key={session.clientId}
                className="flex flex-col gap-3 rounded-md bg-muted px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{session.name}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    Connected {formatDate(session.connectedAt)}
                    {session.lastAuthorizedAt > session.connectedAt
                      ? ` · Last authorized ${formatDate(session.lastAuthorizedAt)}`
                      : ''}
                    {session.expiresAt ? ` · Expires ${formatDate(session.expiresAt)}` : ''}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="destructive-outline"
                  className="w-fit shrink-0"
                  disabled={revoking === session.clientId}
                  onClick={async () => {
                    if (!window.confirm(`Revoke ${session.name}'s access to Loora?`)) return
                    setRevoking(session.clientId)
                    setError('')
                    try {
                      await orpc.mcp.revoke({ clientId: session.clientId })
                      setSessions(
                        (current) =>
                          current?.filter((item) => item.clientId !== session.clientId) ?? null,
                      )
                    } catch {
                      setError(`Could not revoke ${session.name}.`)
                    } finally {
                      setRevoking(null)
                    }
                  }}
                >
                  <UnplugIcon data-slot="icon" />
                  {revoking === session.clientId ? 'Revoking…' : 'Revoke'}
                </Button>
              </div>
            ))}
          </div>
        )}

        {error ? <p className="text-xs text-destructive-foreground">{error}</p> : null}
      </div>
    </IntegrationCard>
  )
}
