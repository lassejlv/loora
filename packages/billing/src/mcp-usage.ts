import { randomUUID } from 'node:crypto'
import type { BillingPlan } from './billing-policy'
import { getPolarClient, getPolarRuntime } from './polar'

export type McpUsagePlan = BillingPlan | 'admin' | 'disabled'

export interface McpIncludedUsage {
  metric: 'mcp_tool_calls'
  plan: McpUsagePlan
  included: number | null
  used: number
  remaining: number | null
  periodStart: string
  resetsAt: string
}

export interface McpUsageMeter {
  readTotal: (input: {
    userId: string
    periodStart: Date
    periodEnd: Date
  }) => Promise<number>
  record: (input: {
    userId: string
    eventId: string
    timestamp: Date
    plan: BillingPlan
  }) => Promise<boolean>
}

export const MCP_USAGE_EVENT = 'loora.mcp_call.v1'

export const MCP_WEEKLY_INCLUDED = {
  free: 200,
  pro: 1_000_000,
  studio: 1_000_000,
} as const satisfies Record<BillingPlan, number>

export class McpUsageLimitError extends Error {
  constructor(readonly usage: McpIncludedUsage) {
    super(
      `Weekly MCP limit reached (${usage.used.toLocaleString()}/${usage.included?.toLocaleString()}). Resets ${usage.resetsAt}.`,
    )
    this.name = 'McpUsageLimitError'
  }
}

export class McpUsageUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('MCP usage is temporarily unavailable. Please retry.', { cause })
    this.name = 'McpUsageUnavailableError'
  }
}

export function mcpUsageWindow(now = new Date()) {
  const day = now.getUTCDay()
  const daysSinceMonday = (day + 6) % 7
  const periodStart = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - daysSinceMonday,
  ))
  const resetsAt = new Date(periodStart)
  resetsAt.setUTCDate(resetsAt.getUTCDate() + 7)
  return { periodStart, resetsAt }
}

export function includedMcpCalls(plan: McpUsagePlan) {
  return plan === 'admin' || plan === 'disabled'
    ? null
    : MCP_WEEKLY_INCLUDED[plan]
}

/**
 * Resolve the MCP usage plan from billing status/authorize results.
 * Admin and billing-disabled accounts are unlimited. Metered plans only
 * apply when access is currently granted (same gate as MCP tool calls).
 */
export function resolveMcpUsagePlan(input: {
  source: 'admin' | 'disabled' | 'cache' | 'polar'
  access: boolean
  plan: BillingPlan | null | undefined
}): McpUsagePlan | null {
  if (input.source === 'admin' || input.source === 'disabled') {
    return input.source
  }
  if (!input.access) return null
  if (input.plan === 'free' || input.plan === 'pro' || input.plan === 'studio') {
    return input.plan
  }
  return null
}

export function mcpUsageSnapshot(
  plan: McpUsagePlan,
  used: number,
  now: Date,
): McpIncludedUsage {
  const window = mcpUsageWindow(now)
  const included = includedMcpCalls(plan)
  const normalizedUsed = Math.max(0, Math.floor(used))
  return {
    metric: 'mcp_tool_calls',
    plan,
    included,
    used: normalizedUsed,
    remaining: included === null
      ? null
      : Math.max(0, included - normalizedUsed),
    periodStart: window.periodStart.toISOString(),
    resetsAt: window.resetsAt.toISOString(),
  }
}

function polarMcpUsageMeter(): McpUsageMeter {
  const { config } = getPolarRuntime()
  if (!config) throw new McpUsageUnavailableError()
  const polar = getPolarClient()
  return {
    async readTotal({ userId, periodStart, periodEnd }) {
      const result = await polar.meters.quantities({
        id: config.mcpMeterId,
        startTimestamp: periodStart,
        endTimestamp: periodEnd,
        interval: 'week',
        timezone: 'UTC',
        externalCustomerId: userId,
      })
      return result.total
    },
    async record({ userId, eventId, timestamp, plan }) {
      const result = await polar.events.ingest({
        events: [{
          name: MCP_USAGE_EVENT,
          externalId: `loora:mcp:${eventId}`,
          externalCustomerId: userId,
          timestamp,
          metadata: {
            metric: 'mcp_tool_calls',
            plan,
            source: 'mcp',
          },
        }],
      })
      return result.inserted > 0
    },
  }
}

export function createMcpUsageService(
  meter: () => McpUsageMeter = polarMcpUsageMeter,
) {
  const queues = new Map<string, Promise<void>>()

  async function serialized<T>(userId: string, run: () => Promise<T>) {
    const previous = queues.get(userId) ?? Promise.resolve()
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const next = previous.catch(() => {}).then(() => gate)
    queues.set(userId, next)
    await previous.catch(() => {})
    try {
      return await run()
    } finally {
      release()
      if (queues.get(userId) === next) queues.delete(userId)
    }
  }

  async function current(
    userId: string,
    plan: McpUsagePlan,
    now = new Date(),
  ) {
    if (plan === 'admin' || plan === 'disabled') {
      return mcpUsageSnapshot(plan, 0, now)
    }
    const window = mcpUsageWindow(now)
    try {
      const used = await meter().readTotal({
        userId,
        periodStart: window.periodStart,
        periodEnd: now,
      })
      return mcpUsageSnapshot(plan, used, now)
    } catch (error) {
      if (error instanceof McpUsageUnavailableError) throw error
      throw new McpUsageUnavailableError(error)
    }
  }

  async function reserve(
    userId: string,
    plan: McpUsagePlan,
    now = new Date(),
  ) {
    if (plan === 'admin' || plan === 'disabled') {
      return mcpUsageSnapshot(plan, 0, now)
    }
    return serialized(userId, async () => {
      const usage = await current(userId, plan, now)
      if (usage.remaining === 0) throw new McpUsageLimitError(usage)
      try {
        const inserted = await meter().record({
          userId,
          eventId: randomUUID(),
          timestamp: now,
          plan,
        })
        return inserted
          ? mcpUsageSnapshot(plan, usage.used + 1, now)
          : usage
      } catch (error) {
        if (error instanceof McpUsageUnavailableError) throw error
        throw new McpUsageUnavailableError(error)
      }
    })
  }

  return { current, reserve }
}

const mcpUsageService = createMcpUsageService()

export const getMcpUsage = mcpUsageService.current
export const reserveMcpCall = mcpUsageService.reserve
