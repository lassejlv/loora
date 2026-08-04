import { useEffect, useState } from 'react'
import { UnplugIcon } from '@loora/ui/icons'
import { Button } from '@loora/ui/button'
import { IntegrationCard, IntegrationStatus } from './integration-card'
import { orpc } from '@loora/rpc/client'
import { apiUrl } from '@loora/platform'

type AssistantStatus = Awaited<ReturnType<typeof orpc.assistant.status>>

/**
 * The other end of `/login-with-chatgpt`. The chat box is where most people
 * will connect; this is where they check what is connected and take it back.
 */
export function ChatGptAccount() {
  const [status, setStatus] = useState<AssistantStatus | null>(null)
  const [error, setError] = useState('')
  const [disconnecting, setDisconnecting] = useState(false)
  const [notice] = useState(() => {
    if (typeof window === 'undefined') return ''
    const result = new URLSearchParams(window.location.search).get('chatgpt')
    if (result === 'connected') return 'ChatGPT is connected.'
    if (result === 'cancelled') return 'The ChatGPT connection was cancelled.'
    if (result === 'unavailable') {
      return 'ChatGPT sign-in is not configured on this server.'
    }
    if (result === 'failed') {
      return 'ChatGPT could not be connected. Try again.'
    }
    return ''
  })

  const load = async () => {
    try {
      setStatus(await orpc.assistant.status())
      setError('')
    } catch {
      setError('Could not load the ChatGPT connection.')
    }
  }

  useEffect(() => {
    void load()
    // Clear only the one-shot OAuth result flag; keep the selected integration.
    const url = new URL(window.location.href)
    if (url.searchParams.has('chatgpt')) {
      url.searchParams.delete('chatgpt')
      window.history.replaceState(window.history.state, '', url)
    }
  }, [])

  if (!status && !error) {
    return (
      <IntegrationCard
        title="ChatGPT"
        status={<IntegrationStatus>Checking…</IntegrationStatus>}
        description="Loading connection status…"
      />
    )
  }

  if (!status) {
    return (
      <IntegrationCard
        title="ChatGPT"
        status={<IntegrationStatus tone="warning">Error</IntegrationStatus>}
        description={error}
      >
        <Button size="sm" variant="outline" className="w-fit" onClick={() => void load()}>
          Try again
        </Button>
      </IntegrationCard>
    )
  }

  if (!status.configured) {
    return (
      <IntegrationCard
        title="ChatGPT"
        status={<IntegrationStatus>Unavailable</IntegrationStatus>}
        description="ChatGPT sign-in is not configured on this Loora server, so the in-app agent is off."
      />
    )
  }

  if (!status.connection) {
    return (
      <IntegrationCard
        title="ChatGPT"
        status={<IntegrationStatus>Not connected</IntegrationStatus>}
        description={`Connect a ChatGPT account and the agent in the editor runs on it. What you type, and the structure of the design it is working on, are sent to OpenAI. Runs use ${status.model}.`}
      >
        {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
        <Button
          size="sm"
          className="w-fit"
          render={<a href={apiUrl('/api/chatgpt/connect')} />}
        >
          Connect ChatGPT
        </Button>
      </IntegrationCard>
    )
  }

  return (
    <IntegrationCard
      title="ChatGPT"
      status={<IntegrationStatus tone="success">Connected</IntegrationStatus>}
      description={
        <>
          {status.connection.email ?? status.connection.name ?? 'ChatGPT account'}
          {status.connection.planType ? ` · ${status.connection.planType}` : ''}
          {` · runs on ${status.model}`}
        </>
      }
    >
      {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="w-fit"
          render={<a href={apiUrl('/api/chatgpt/connect')} />}
        >
          Reconnect
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="w-fit"
          disabled={disconnecting}
          onClick={async () => {
            setDisconnecting(true)
            try {
              await orpc.assistant.disconnect()
              await load()
            } catch {
              setError('Could not disconnect ChatGPT.')
            } finally {
              setDisconnecting(false)
            }
          }}
        >
          <UnplugIcon />
          Disconnect
        </Button>
      </div>
    </IntegrationCard>
  )
}
