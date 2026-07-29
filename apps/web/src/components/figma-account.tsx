import { useEffect, useState } from 'react'
import { UnplugIcon } from '#/components/icons'
import { FigmaIcon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import { IntegrationCard, IntegrationStatus } from '#/components/integration-card'
import { orpc } from '#/lib/orpc-client'

type FigmaStatus = Awaited<ReturnType<typeof orpc.figma.status>>

const settingsReturnTo = '/?settings=integrations&integration=figma'

export function FigmaAccount() {
  const [status, setStatus] = useState<FigmaStatus | null>(null)
  const [error, setError] = useState('')
  const [disconnecting, setDisconnecting] = useState(false)
  const [notice] = useState(() => {
    if (typeof window === 'undefined') return ''
    const result = new URLSearchParams(window.location.search).get('figma')
    if (result === 'connected') return 'Figma access is connected.'
    if (result === 'cancelled') return 'Figma connection was cancelled.'
    if (result === 'unavailable') return 'Figma access is not configured on this server.'
    if (result === 'failed') return 'Figma could not be connected. Check the app settings and try again.'
    return ''
  })

  const load = async () => {
    try {
      setStatus(await orpc.figma.status())
      setError('')
    } catch {
      setError('Could not load the Figma connection.')
    }
  }

  useEffect(() => {
    void load()
    const url = new URL(window.location.href)
    if (url.searchParams.has('figma')) {
      url.searchParams.delete('figma')
      window.history.replaceState(window.history.state, '', url)
    }
  }, [])

  if (!status && !error) {
    return (
      <IntegrationCard
        title="Figma"
        status={<IntegrationStatus>Checking…</IntegrationStatus>}
        description="Loading connection status…"
      />
    )
  }

  if (!status) {
    return (
      <IntegrationCard
        title="Figma"
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
        title="Figma"
        status={<IntegrationStatus>Unavailable</IntegrationStatus>}
        description="Figma importing is not configured on this Loora server."
      />
    )
  }

  if (!status.connected) {
    return (
      <IntegrationCard
        title="Figma"
        status={<IntegrationStatus>Not connected</IntegrationStatus>}
        description="Connect Figma so Loora can read files you explicitly paste into the importer. Loora requests read-only file content access."
      >
        <Button
          size="sm"
          className="w-fit"
          onClick={() =>
            window.location.assign(
              `/api/figma/connect?returnTo=${encodeURIComponent(settingsReturnTo)}`,
            )
          }
        >
          <FigmaIcon data-slot="icon" />
          Connect Figma
        </Button>
        {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
      </IntegrationCard>
    )
  }

  return (
    <IntegrationCard
      title="Figma"
      status={<IntegrationStatus tone="success">Connected</IntegrationStatus>}
      description="Paste Figma Design links into the document importer. Imported documents are independent copies and do not sync back to Figma."
    >
      <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Loora can only read files available to this Figma account.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="w-fit shrink-0"
          disabled={disconnecting}
          onClick={async () => {
            if (!window.confirm('Disconnect Figma from Loora?')) return
            setDisconnecting(true)
            setError('')
            try {
              await orpc.figma.disconnect()
              await load()
            } catch {
              setError('Could not disconnect Figma.')
            } finally {
              setDisconnecting(false)
            }
          }}
        >
          <UnplugIcon data-slot="icon" />
          {disconnecting ? 'Disconnecting…' : 'Disconnect'}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive-foreground">{error}</p> : null}
      {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
    </IntegrationCard>
  )
}
