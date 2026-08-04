import { useEffect, useState } from 'react'
import { authClient } from '@loora/auth/client'
import {
  AGENT_WEEKLY_INCLUDED,
  MCP_WEEKLY_INCLUDED,
} from '@loora/billing/mcp-usage'
import { Button } from '@loora/ui/button'
import { PanelLoading } from '@loora/ui/panel-shell'
import { orpc } from '@loora/rpc/client'

type BillingStatus = Awaited<ReturnType<typeof orpc.billing.status>>
type McpUsageResponse = Awaited<ReturnType<typeof orpc.billing.mcpUsage>>
type McpUsage = NonNullable<McpUsageResponse['usage']>

function formatCount(value: number) {
  return value.toLocaleString()
}

function formatResetDate(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
}

/**
 * MCP and the in-app agent are metered separately, so they get a card each
 * rather than one number that would hide which surface ran out.
 */
interface UsageCopy {
  title: string
  /** What an account with no ceiling is told. */
  unmetered: string
  noPlan: string
  meterLabel: string
  loadError: string
}

const MCP_COPY: UsageCopy = {
  title: 'MCP calls this week',
  unmetered: 'MCP tool calls are not metered on this account.',
  noPlan: `Subscribe to a plan to use the MCP server. Free includes ${formatCount(MCP_WEEKLY_INCLUDED.free)} calls per week; Pro and Studio include ${formatCount(MCP_WEEKLY_INCLUDED.pro)}.`,
  meterLabel: 'MCP calls used this week',
  loadError: 'Could not load MCP usage. Please try again.',
}

const AGENT_COPY: UsageCopy = {
  title: 'Agent calls this week',
  unmetered: 'In-app agent calls are not metered on this account.',
  noPlan: `Subscribe to a plan to use the in-app agent. Free includes ${formatCount(AGENT_WEEKLY_INCLUDED.free)} calls per week; Pro and Studio include ${formatCount(AGENT_WEEKLY_INCLUDED.pro)}.`,
  meterLabel: 'Agent calls used this week',
  loadError: 'Could not load agent usage. Please try again.',
}

function UsageCard({ usage, copy }: { usage: McpUsage; copy: UsageCopy }) {
  if (usage.included === null) {
    return (
      <div className="rounded-md border border-line bg-surface p-4">
        <p className="text-xs text-muted-foreground">{copy.title}</p>
        <p className="mt-1 text-lg font-semibold">Unlimited</p>
        <p className="mt-2 text-xs text-muted-foreground">{copy.unmetered}</p>
      </div>
    )
  }

  const percent = usage.included === 0
    ? 0
    : Math.min(100, Math.round((usage.used / usage.included) * 100))
  const meterNow = Math.min(usage.used, usage.included)
  const exhausted = usage.remaining === 0

  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <p className="text-xs text-muted-foreground">{copy.title}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">
        {formatCount(usage.used)}
        <span className="text-sm font-normal text-muted-foreground">
          {' '}/ {formatCount(usage.included)}
        </span>
      </p>
      <div
        className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-input"
        role="meter"
        aria-label={copy.meterLabel}
        aria-valuemin={0}
        aria-valuemax={usage.included}
        aria-valuenow={meterNow}
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            exhausted ? 'bg-destructive' : 'bg-primary'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <p>
          {exhausted
            ? 'Weekly limit reached'
            : `${formatCount(usage.remaining ?? 0)} remaining`}
        </p>
        <p>Resets {formatResetDate(usage.resetsAt)}</p>
      </div>
    </div>
  )
}

function UsageSection({
  usage,
  usageError,
  copy,
  onRetry,
}: {
  usage: McpUsage | null | undefined
  usageError: string
  copy: UsageCopy
  onRetry: () => void
}) {
  if (usageError) {
    return (
      <div className="rounded-md border border-line bg-surface p-4">
        <p className="text-xs text-muted-foreground">{copy.title}</p>
        <p className="mt-2 text-xs text-destructive-foreground">{usageError}</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      </div>
    )
  }

  if (usage === undefined) {
    return (
      <div className="rounded-md border border-line bg-surface p-4">
        <p className="text-xs text-muted-foreground">{copy.title}</p>
        <p className="mt-2 text-xs text-muted-foreground">Loading usage…</p>
      </div>
    )
  }

  if (usage === null) {
    return (
      <div className="rounded-md border border-line bg-surface p-4">
        <p className="text-xs text-muted-foreground">{copy.title}</p>
        <p className="mt-1 text-lg font-semibold">No plan</p>
        <p className="mt-2 text-xs text-muted-foreground">{copy.noPlan}</p>
      </div>
    )
  }

  return <UsageCard usage={usage} copy={copy} />
}

/** One surface's number, loaded on its own so neither hides the other. */
function useToolUsage(
  read: () => Promise<{ usage: McpUsage | null }>,
  copy: UsageCopy,
) {
  const [usage, setUsage] = useState<McpUsage | null | undefined>(undefined)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const result = await read()
      setUsage(result.usage)
      setError('')
    } catch (err) {
      setUsage(undefined)
      const message = err instanceof Error ? err.message.trim() : ''
      setError(message || copy.loadError)
    }
  }

  return { usage, error, load }
}

export function BillingSettings() {
  const { data: session } = authClient.useSession()
  const [billing, setBilling] = useState<BillingStatus | null>(null)
  const [error, setError] = useState('')
  const [openingPortal, setOpeningPortal] = useState(false)
  const mcp = useToolUsage(() => orpc.billing.mcpUsage(), MCP_COPY)
  const agent = useToolUsage(() => orpc.billing.agentUsage(), AGENT_COPY)

  const loadBilling = async () => {
    try {
      setBilling(await orpc.billing.status())
      setError('')
    } catch {
      setError('Could not load billing.')
    }
  }

  useEffect(() => {
    void loadBilling()
    void mcp.load()
    void agent.load()
  }, [])

  const usageSection = (
    <div className="grid gap-3 sm:grid-cols-2">
      <UsageSection
        usage={mcp.usage}
        usageError={mcp.error}
        copy={MCP_COPY}
        onRetry={() => void mcp.load()}
      />
      <UsageSection
        usage={agent.usage}
        usageError={agent.error}
        copy={AGENT_COPY}
        onRetry={() => void agent.load()}
      />
    </div>
  )

  if (session?.user?.isAdmin) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <h2 className="text-sm font-semibold">Internal access</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Admin accounts bypass subscriptions and keep full editor access.
          </p>
        </div>
        {usageSection}
      </div>
    )
  }

  if (!billing && !error) return <PanelLoading label="Loading billing…" />

  if (!billing) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-xs text-destructive-foreground">{error}</p>
        <Button size="sm" variant="outline" onClick={() => void loadBilling()}>
          Try again
        </Button>
      </div>
    )
  }

  if (!billing.required) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <h2 className="text-sm font-semibold">Billing is disabled</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            This Loora environment does not require a subscription.
          </p>
        </div>
        {usageSection}
      </div>
    )
  }

  const plan = billing.trial
    ? 'Pro trial'
    : billing.plan === 'studio'
      ? 'Studio (legacy)'
      : billing.plan === 'pro'
        ? 'Pro'
        : billing.plan === 'free'
          ? 'Free'
          : 'No plan'

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-md border border-line bg-surface p-4">
        <p className="text-xs text-muted-foreground">Current plan</p>
        <p className="mt-1 text-lg font-semibold">{plan}</p>
        {billing.trial ? (
          <div className="mt-3 rounded-md bg-secondary px-3 py-2 text-xs">
            <p>Your trial ends {new Date(billing.trial.endsAt).toLocaleDateString()}.</p>
            <p className="mt-1 text-muted-foreground">
              Full canvas, branches, exports, and the MCP server are included for the whole trial.
            </p>
          </div>
        ) : null}
        {billing.cancelAtPeriodEnd && billing.currentPeriodEnd ? (
          <p className="mt-3 rounded-md bg-secondary px-3 py-2 text-xs">
            Your plan ends {new Date(billing.currentPeriodEnd).toLocaleDateString()}.
            Access remains active until then.
          </p>
        ) : null}
      </div>

      {usageSection}

      <div className="flex flex-col items-start gap-2">
        <Button
          variant="outline"
          disabled={openingPortal || !billing.plan}
          onClick={async () => {
            setOpeningPortal(true)
            setError('')
            try {
              await authClient.customer.portal()
            } catch {
              setError('Could not open the billing portal.')
              setOpeningPortal(false)
            }
          }}
        >
          {openingPortal ? 'Opening portal…' : 'Manage billing'}
        </Button>
        {error ? <p className="text-xs text-destructive-foreground">{error}</p> : null}
      </div>
    </div>
  )
}
