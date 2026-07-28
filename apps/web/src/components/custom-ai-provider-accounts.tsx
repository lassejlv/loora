import { useEffect, useState } from 'react'
import { KeyRoundIcon, UnplugIcon } from 'lucide-react'
import { ExternalLinkIcon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { IntegrationCard, IntegrationStatus } from '#/components/integration-card'
import { orpc } from '#/lib/orpc-client'

type CustomAiProvider = 'google' | 'openai' | 'anthropic'

const PROVIDERS = {
  google: {
    title: 'Google Gemini',
    placeholder: 'AIza…',
    keyUrl: 'https://aistudio.google.com/apikey',
    models: 'Gemini 3.5 Flash, Gemini 3.1 Pro, and Gemini 3.1 Flash Lite',
  },
  openai: {
    title: 'OpenAI',
    placeholder: 'sk-…',
    keyUrl: 'https://platform.openai.com/api-keys',
    models: 'GPT-5.6 Sol, Terra, and Luna',
  },
  anthropic: {
    title: 'Anthropic',
    placeholder: 'sk-ant-…',
    keyUrl: 'https://platform.claude.com/settings/keys',
    models: 'Claude Opus 5 and Claude Sonnet 5',
  },
} as const

type ConnectionStatus = {
  connected: boolean
  updatedAt: Date | null
}

function requestError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function CustomAiProviderAccount({ provider }: { provider: CustomAiProvider }) {
  const config = PROVIDERS[provider]
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      setStatus(await orpc.aiProvider.status({ provider }))
      setError('')
    } catch (nextError) {
      setError(requestError(nextError, `Could not load the ${config.title} connection.`))
    }
  }

  useEffect(() => {
    void load()
  }, [provider])

  if (!status && !error) {
    return (
      <IntegrationCard
        title={config.title}
        status={<IntegrationStatus>Checking…</IntegrationStatus>}
        description="Loading connection status…"
      />
    )
  }

  if (!status) {
    return (
      <IntegrationCard
        title={config.title}
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
      title={config.title}
      status={
        <IntegrationStatus tone={status.connected ? 'success' : 'neutral'}>
          {status.connected ? 'Connected' : 'Not connected'}
        </IntegrationStatus>
      }
      description={
        status.connected
          ? `${config.models} are available in the agent model picker.`
          : `Use your own ${config.title} API key and provider balance. Loora does not charge AI credits for these requests.`
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
              await orpc.aiProvider.connect({ provider, apiKey: key })
              setApiKey('')
              setReplacing(false)
              await load()
            } catch (nextError) {
              setError(requestError(nextError, `Could not connect ${config.title}.`))
            } finally {
              setBusy(false)
            }
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor={`${provider}-api-key`} className="text-xs font-medium">
              API key
            </label>
            <Input
              id={`${provider}-api-key`}
              type="password"
              value={apiKey}
              autoComplete="off"
              spellCheck={false}
              placeholder={config.placeholder}
              disabled={busy}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              The key is verified with {config.title}, encrypted before storage, and never returned
              to your browser.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" type="submit" disabled={busy || !apiKey.trim()}>
              <KeyRoundIcon data-slot="icon" />
              {busy ? 'Checking…' : status.connected ? 'Replace key' : `Connect ${config.title}`}
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
              onClick={() => window.open(config.keyUrl, '_blank', 'noopener,noreferrer')}
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
              if (!window.confirm(`Disconnect ${config.title} from Loora?`)) return
              setBusy(true)
              setError('')
              try {
                await orpc.aiProvider.disconnect({ provider })
                setStatus({ connected: false, updatedAt: null })
              } catch (nextError) {
                setError(requestError(nextError, `Could not disconnect ${config.title}.`))
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

export function CustomAiProviderAccounts() {
  return (
    <div className="flex flex-col gap-4">
      <CustomAiProviderAccount provider="google" />
      <CustomAiProviderAccount provider="openai" />
      <CustomAiProviderAccount provider="anthropic" />
    </div>
  )
}
