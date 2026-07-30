import { formatStorageBytes } from '@loora/billing/plan-limits'
import type { AdminOverview } from '#/components/admin/types'

function StatTile({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <p className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function plural(count: number, noun: string) {
  return `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`
}

export function AdminStats({ overview }: { overview: AdminOverview }) {
  const { users, designs, storage, mcp } = overview
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <StatTile
        label="Users"
        value={users.total.toLocaleString()}
        hint={`+${users.newLast7Days.toLocaleString()} this week · ${plural(users.admins, 'admin')}`}
      />
      <StatTile
        label="Active (24h)"
        value={users.activeLast24Hours.toLocaleString()}
        hint={`${users.previewGranted.toLocaleString()} with preview access`}
      />
      <StatTile
        label="Design files"
        value={designs.total.toLocaleString()}
        hint={`+${designs.newLast7Days.toLocaleString()} this week · ${designs.openBranches.toLocaleString()} open branches`}
      />
      <StatTile
        label="Asset storage"
        value={formatStorageBytes(storage.bytes)}
        hint={plural(storage.assets, 'file')}
      />
      <StatTile
        label="Pending access"
        value={users.pendingPreviewRequests.toLocaleString()}
        hint="Preview requests awaiting review"
      />
      <StatTile
        label="MCP clients"
        value={mcp.connectedClients.toLocaleString()}
        hint={`${plural(mcp.connectedUsers, 'account')} connected`}
      />
      <StatTile
        label="Live publish links"
        value={designs.livePublishLinks.toLocaleString()}
        hint="Unexpired public pages"
      />
      <StatTile
        label="Versions (7d)"
        value={designs.versionsLast7Days.toLocaleString()}
        hint="Committed design versions"
      />
    </div>
  )
}
