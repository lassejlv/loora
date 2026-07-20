import { useEffect, useState } from 'react'
import { CableIcon, UnplugIcon } from 'lucide-react'
import { LoaderCircleIcon, RefreshCwIcon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import { orpc } from '#/lib/orpc-client'

type McpSession = Awaited<ReturnType<typeof orpc.mcp.sessions>>[number]

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
  }, [])

  if (!sessions && !error) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <LoaderCircleIcon className="size-3.5 animate-spin" />
        Loading MCP sessions…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Clients with access can read and update your Loora designs.
        </p>
        <Button
          size="icon-sm"
          variant="ghost"
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

      {sessions?.length === 0 ? (
        <div className="rounded-xl border border-border p-4 text-xs text-muted-foreground">
          No MCP clients are connected.
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border">
          {sessions?.map((session) => (
            <div
              key={session.clientId}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <CableIcon className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{session.name}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    Connected {formatDate(session.connectedAt)}
                    {session.lastAuthorizedAt > session.connectedAt
                      ? ` · Last authorized ${formatDate(session.lastAuthorizedAt)}`
                      : ''}
                    {session.expiresAt ? ` · Access expires ${formatDate(session.expiresAt)}` : ''}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="destructive-outline"
                disabled={revoking === session.clientId}
                onClick={async () => {
                  if (!window.confirm(`Revoke ${session.name}'s access to Loora?`)) return
                  setRevoking(session.clientId)
                  setError('')
                  try {
                    await orpc.mcp.revoke({ clientId: session.clientId })
                    setSessions((current) =>
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
  )
}
