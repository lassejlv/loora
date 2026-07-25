import { useEffect, useState } from 'react'
import { ExternalLinkIcon, KeyRoundIcon, UnplugIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { IntegrationCard, IntegrationStatus } from '#/components/integration-card'
import { orpc } from '#/lib/orpc-client'

type OpenRouterStatus = Awaited<ReturnType<typeof orpc.openrouter.status>>

function requestError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function OpenRouterAccount() {
  const [status, setStatus] = useState<OpenRouterStatus | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      setStatus(await orpc.openrouter.status())
      setError('')
    } catch (nextError) {
      setError(requestError(nextError, 'Could not load the OpenRouter connection.'))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  if (!status && !error) {
    return (
      <IntegrationCard
        title="OpenRouter"
        status={<IntegrationStatus>Checking…</IntegrationStatus>}
        description="Loading connection status…"
      />
    )
  }

  if (!status) {
    return (
      <IntegrationCard
        title="OpenRouter"
        status={<IntegrationStatus tone="warning">Error</IntegrationStatus>}
        description={error}
      >
        <Button size="sm" variant="outline" className="w-fit" onClick={() => void load()}>
          Try again
        </Button>
      </IntegrationCard>
    )
  }

  const showKeyForm = !status.connected || replacing

  return (
    <IntegrationCard
      title="OpenRouter"
      status={
        <IntegrationStatus tone={status.connected ? 'success' : 'neutral'}>
          {status.connected ? 'Connected' : 'Not connected'}
        </IntegrationStatus>
      }
      description={
        status.connected
          ? `${status.label || 'OpenRouter API key'} · OpenRouter Auto is available in the agent model picker.`
          : 'Use your own OpenRouter API key and balance. Loora does not charge AI credits for these requests.'
      }
    >
      {showKeyForm ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={async (event) => {
            event.preventDefault()
            const key = apiKey.trim()
            if (!key) return
            setBusy(true)
            setError('')
            try {
              await orpc.openrouter.connect({ apiKey: key })
              setApiKey('')
              setReplacing(false)
              await load()
            } catch (nextError) {
              setError(requestError(nextError, 'Could not connect OpenRouter.'))
            } finally {
              setBusy(false)
            }
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="openrouter-api-key" className="text-xs font-medium">
              API key
            </label>
            <Input
              id="openrouter-api-key"
              type="password"
              value={apiKey}
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-or-v1-…"
              disabled={busy}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              The key is verified with OpenRouter, encrypted before storage, and never returned to
              your browser.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" type="submit" disabled={busy || !apiKey.trim()}>
              <KeyRoundIcon data-slot="icon" />
              {busy ? 'Checking…' : status.connected ? 'Replace key' : 'Connect OpenRouter'}
            </Button>
            {replacing ? (
              <Button
                size="sm"
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setApiKey('')
                  setReplacing(false)
                  setError('')
                }}
              >
                Cancel
              </Button>
            ) : null}
            <Button
              size="sm"
              type="button"
              variant="ghost"
              onClick={() =>
                window.open('https://openrouter.ai/settings/keys', '_blank', 'noopener,noreferrer')
              }
            >
              <ExternalLinkIcon data-slot="icon" />
              Create a key
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setReplacing(true)}>
            <KeyRoundIcon data-slot="icon" />
            Replace key
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm('Disconnect OpenRouter from Loora?')) return
              setBusy(true)
              setError('')
              try {
                await orpc.openrouter.disconnect()
                setStatus({ connected: false, label: null, updatedAt: null })
              } catch (nextError) {
                setError(requestError(nextError, 'Could not disconnect OpenRouter.'))
              } finally {
                setBusy(false)
              }
            }}
          >
            <UnplugIcon data-slot="icon" />
            {busy ? 'Disconnecting…' : 'Disconnect'}
          </Button>
        </div>
      )}
      {error ? <p className="text-xs text-destructive-foreground">{error}</p> : null}
    </IntegrationCard>
  )
}
