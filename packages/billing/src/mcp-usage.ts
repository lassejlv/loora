import type { BillingPlan } from './billing-policy'
import { getPolarRuntime } from './polar'

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

async function loadPolarMcpRuntime() {
  const { config } = getPolarRuntime()
  if (!config) throw new McpUsageUnavailableError()
  const [
    { PolarCore },
    { eventsIngest },
    { metersQuantities },
  ] = await Promise.all([
    import('@polar-sh/sdk/core.js'),
    import('@polar-sh/sdk/funcs/eventsIngest.js'),
    import('@polar-sh/sdk/funcs/metersQuantities.js'),
  ])
  const client = new PolarCore({
    accessToken: config.accessToken,
    server: config.server,
    timeoutMs: 4_000,
  })
  return { client, eventsIngest, metersQuantities }
}

let polarMcpRuntime: ReturnType<typeof loadPolarMcpRuntime> | undefined

function getPolarMcpRuntime() {
  return polarMcpRuntime ??= loadPolarMcpRuntime()
}

function polarMcpUsageMeter(): McpUsageMeter {
  const { config } = getPolarRuntime()
  if (!config) throw new McpUsageUnavailableError()
  return {
    async readTotal({ userId, periodStart, periodEnd }) {
      const { client, metersQuantities } = await getPolarMcpRuntime()
      const result = await metersQuantities(client, {
        id: config.mcpMeterId,
        startTimestamp: periodStart,
        endTimestamp: periodEnd,
        interval: 'week',
        timezone: 'UTC',
        externalCustomerId: userId,
      })
      if (!result.ok) throw result.error
      return result.value.total
    },
    async record({ userId, eventId, timestamp, plan }) {
      const { client, eventsIngest } = await getPolarMcpRuntime()
      const result = await eventsIngest(client, {
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
      if (!result.ok) throw result.error
      return result.value.inserted > 0
    },
  }
}

/**
 * How long a Polar meter read stays fresh for admission checks. Between
 * reads the service trusts its local per-user counter, so a tool call does
 * not pay a Polar round trip on the hot path more than once per window.
 */
const USAGE_READ_TTL_MS = 30_000

interface UsedCounter {
  used: number
  periodStart: number
  /** Epoch ms of the last Polar read backing this counter; 0 = never read. */
  readAt: number
}

export function createMcpUsageService(
  meter: () => McpUsageMeter = polarMcpUsageMeter,
  readTtlMs = USAGE_READ_TTL_MS,
) {
  const queues = new Map<string, Promise<void>>()
  const counters = new Map<string, UsedCounter>()

  function counterFor(userId: string, periodStart: Date): UsedCounter {
    const start = periodStart.getTime()
    const existing = counters.get(userId)
    if (existing && existing.periodStart === start) return existing
    const fresh: UsedCounter = { used: 0, periodStart: start, readAt: 0 }
    counters.set(userId, fresh)
    return fresh
  }

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
      // Keep the admission counter in sync. Polar's total can lag events the
      // local counter already knows about, so never let a read move it back.
      const counter = counterFor(userId, window.periodStart)
      counter.used = Math.max(counter.used, Math.max(0, Math.floor(used)))
      counter.readAt = now.getTime()
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
    const window = mcpUsageWindow(now)

    // Pro and Studio include a million calls a week — the limit is not
    // reachable in practice, so the call never waits on Polar. The event is
    // recorded in the background and the snapshot comes from the local
    // counter; getUsage still reads the real total.
    if (plan !== 'free') {
      const counter = counterFor(userId, window.periodStart)
      counter.used += 1
      void (async () => {
        try {
          await meter().record({
            userId,
            eventId: crypto.randomUUID(),
            timestamp: now,
            plan,
          })
        } catch (error) {
          console.error('[mcp-usage] deferred usage event failed', error)
        }
      })()
      return mcpUsageSnapshot(plan, counter.used, now)
    }

    // Free has a small quota, so admission stays strict: read Polar when the
    // counter is stale, count locally in between, and record before running.
    return serialized(userId, async () => {
      const counter = counterFor(userId, window.periodStart)
      const nowMs = now.getTime()
      if (counter.readAt === 0 || nowMs - counter.readAt > readTtlMs) {
        try {
          const used = await meter().readTotal({
            userId,
            periodStart: window.periodStart,
            periodEnd: now,
          })
          counter.used = Math.max(counter.used, Math.max(0, Math.floor(used)))
          counter.readAt = nowMs
        } catch (error) {
          if (error instanceof McpUsageUnavailableError) throw error
          throw new McpUsageUnavailableError(error)
        }
      }
      const usage = mcpUsageSnapshot(plan, counter.used, now)
      if (usage.remaining === 0) throw new McpUsageLimitError(usage)
      try {
        const inserted = await meter().record({
          userId,
          eventId: crypto.randomUUID(),
          timestamp: now,
          plan,
        })
        if (inserted) counter.used += 1
        return mcpUsageSnapshot(plan, counter.used, now)
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
