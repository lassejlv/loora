export interface McpTokenRecord {
  clientId: string | null
  clientName: string | null
  createdAt: Date
  updatedAt: Date
  accessTokenExpiresAt: Date | null
  refreshTokenExpiresAt: Date | null
}

export interface McpSessionSummary {
  clientId: string
  name: string
  connectedAt: number
  lastAuthorizedAt: number
  expiresAt: number | null
}

export function summarizeMcpSessions(rows: McpTokenRecord[]) {
  const sessions = new Map<string, McpSessionSummary>()

  for (const row of rows) {
    if (!row.clientId) continue
    const expiresAt = Math.max(
      row.accessTokenExpiresAt?.getTime() ?? 0,
      row.refreshTokenExpiresAt?.getTime() ?? 0,
    ) || null
    const existing = sessions.get(row.clientId)
    if (!existing) {
      sessions.set(row.clientId, {
        clientId: row.clientId,
        name: row.clientName?.trim() || 'MCP client',
        connectedAt: row.createdAt.getTime(),
        lastAuthorizedAt: row.updatedAt.getTime(),
        expiresAt,
      })
      continue
    }
    existing.connectedAt = Math.min(existing.connectedAt, row.createdAt.getTime())
    existing.lastAuthorizedAt = Math.max(existing.lastAuthorizedAt, row.updatedAt.getTime())
    existing.expiresAt = Math.max(existing.expiresAt ?? 0, expiresAt ?? 0) || null
  }

  return [...sessions.values()]
}
