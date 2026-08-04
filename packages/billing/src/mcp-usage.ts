/**
 * Weekly tool-call metering, over two independent surfaces.
 *
 * `mcp` counts what an external client does through the remote MCP transport.
 * `agent` counts what the in-app agent does in the editor. They share every
 * mechanism — the same window, the same admission logic, the same Polar
 * plumbing — and nothing else: separate meters, separate event names, separate
 * included allowances, separate per-account overrides, separate counters.
 * Somebody's agent working through a design cannot lock their MCP client out,
 * and the reverse.
 */
import type { BillingPlan } from './billing-policy'
import { getPolarRuntime } from './polar'

export type McpUsagePlan = BillingPlan | 'admin' | 'disabled'

/** Which surface a number belongs to. Present on every snapshot. */
export type UsageMetric = 'mcp_tool_calls' | 'agent_tool_calls'

export interface McpIncludedUsage {
  metric: UsageMetric
  plan: McpUsagePlan
  included: number | null
  used: number
  remaining: number | null
  periodStart: string
  resetsAt: string
}

/** Neutral name for the same shape, for code that is not about MCP. */
export type ToolUsage = McpIncludedUsage

export interface McpUsageOptions {
  weeklyLimit?: number | null
  resetAt?: Date | null
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
export const AGENT_USAGE_EVENT = 'loora.agent_call.v1'

export const MCP_WEEKLY_INCLUDED = {
  free: 100,
  pro: 1_000_000,
  studio: 1_000_000,
} as const satisfies Record<BillingPlan, number>

/**
 * The agent spends calls in bursts — one instruction is a read, a handful of
 * batched writes and a screenshot — so Free gets a wider allowance here than
 * on MCP, where a call is usually one deliberate request.
 */
export const AGENT_WEEKLY_INCLUDED = {
  free: 500,
  pro: 1_000_000,
  studio: 1_000_000,
} as const satisfies Record<BillingPlan, number>

export interface UsageSurface {
  metric: UsageMetric
  /** Polar event name. One per surface, so one meter cannot see the other. */
  event: string
  /** `metadata.source` on the event. */
  source: 'mcp' | 'agent'
  included: Record<BillingPlan, number>
  /** What to call this in a sentence somebody reads. */
  label: string
  /** The Polar meter, or null when this surface has not been provisioned. */
  meterId: () => string | null
}

export const MCP_USAGE_SURFACE: UsageSurface = {
  metric: 'mcp_tool_calls',
  event: MCP_USAGE_EVENT,
  source: 'mcp',
  included: MCP_WEEKLY_INCLUDED,
  label: 'MCP',
  meterId: () => getPolarRuntime().config?.mcpMeterId ?? null,
}

export const AGENT_USAGE_SURFACE: UsageSurface = {
  metric: 'agent_tool_calls',
  event: AGENT_USAGE_EVENT,
  source: 'agent',
  included: AGENT_WEEKLY_INCLUDED,
  label: 'agent',
  meterId: () => getPolarRuntime().config?.agentMeterId ?? null,
}

const SURFACES: Record<UsageMetric, UsageSurface> = {
  mcp_tool_calls: MCP_USAGE_SURFACE,
  agent_tool_calls: AGENT_USAGE_SURFACE,
}

export function usageSurfaceFor(metric: UsageMetric) {
  return SURFACES[metric]
}

export class McpUsageLimitError extends Error {
  constructor(readonly usage: McpIncludedUsage) {
    super(
      `Weekly ${usageSurfaceFor(usage.metric).label} limit reached (${usage.used.toLocaleString()}/${usage.included?.toLocaleString()}). Resets ${usage.resetsAt}.`,
    )
    this.name = 'McpUsageLimitError'
  }
}

export class McpUsageUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Usage metering is temporarily unavailable. Please retry.', { cause })
    this.name = 'McpUsageUnavailableError'
  }
}

/** A surface whose meter is not provisioned has nowhere to put its events. */
export class UsageMeterUnconfiguredError extends Error {
  constructor(readonly surface: UsageSurface) {
    super(`No Polar meter is configured for ${surface.label} usage.`)
    this.name = 'UsageMeterUnconfiguredError'
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

export function includedCalls(
  surface: UsageSurface,
  plan: McpUsagePlan,
  weeklyLimit?: number | null,
) {
  return plan === 'admin' || plan === 'disabled'
    ? null
    : Math.max(surface.included[plan], Math.floor(weeklyLimit ?? 0))
}

export function includedMcpCalls(plan: McpUsagePlan, weeklyLimit?: number | null) {
  return includedCalls(MCP_USAGE_SURFACE, plan, weeklyLimit)
}

export function includedAgentCalls(plan: McpUsagePlan, weeklyLimit?: number | null) {
  return includedCalls(AGENT_USAGE_SURFACE, plan, weeklyLimit)
}

/**
 * Resolve the usage plan from billing status/authorize results. Admin and
 * billing-disabled accounts are unlimited. Metered plans only apply when
 * access is currently granted (same gate as the tool calls themselves).
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

export function usageSnapshot(
  surface: UsageSurface,
  plan: McpUsagePlan,
  used: number,
  now: Date,
  weeklyLimit?: number | null,
): McpIncludedUsage {
  const window = mcpUsageWindow(now)
  const included = includedCalls(surface, plan, weeklyLimit)
  const normalizedUsed = Math.max(0, Math.floor(used))
  return {
    metric: surface.metric,
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

export function mcpUsageSnapshot(
  plan: McpUsagePlan,
  used: number,
  now: Date,
  weeklyLimit?: number | null,
): McpIncludedUsage {
  return usageSnapshot(MCP_USAGE_SURFACE, plan, used, now, weeklyLimit)
}

function meteringPeriodStart(now: Date, resetAt?: Date | null) {
  const { periodStart } = mcpUsageWindow(now)
  return resetAt && resetAt > periodStart && resetAt <= now ? resetAt : periodStart
}

async function loadPolarUsageRuntime() {
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

let polarUsageRuntime: ReturnType<typeof loadPolarUsageRuntime> | undefined

function getPolarUsageRuntime() {
  return polarUsageRuntime ??= loadPolarUsageRuntime()
}

function polarUsageMeter(surface: UsageSurface): McpUsageMeter {
  const meterId = surface.meterId()
  if (!meterId) throw new UsageMeterUnconfiguredError(surface)
  return {
    async readTotal({ userId, periodStart, periodEnd }) {
      const { client, metersQuantities } = await getPolarUsageRuntime()
      const result = await metersQuantities(client, {
        id: meterId,
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
      const { client, eventsIngest } = await getPolarUsageRuntime()
      const result = await eventsIngest(client, {
        events: [{
          name: surface.event,
          externalId: `loora:${surface.source}:${eventId}`,
          externalCustomerId: userId,
          timestamp,
          metadata: {
            metric: surface.metric,
            plan,
            source: surface.source,
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

const warnedSurfaces = new Set<UsageMetric>()

/**
 * A surface with no meter behind it does not block anybody: it reports
 * unmetered and says so once. That keeps a deploy that has not been given
 * `POLAR_AGENT_METER_ID` yet working, at the cost of not counting until it is.
 */
function unmeteredSnapshot(surface: UsageSurface, now: Date) {
  if (!warnedSurfaces.has(surface.metric)) {
    warnedSurfaces.add(surface.metric)
    console.warn(
      `[usage] ${surface.label} calls are not being metered: no Polar meter is configured for them.`,
    )
  }
  return usageSnapshot(surface, 'disabled', 0, now)
}

export function createUsageService(
  surface: UsageSurface,
  meter: () => McpUsageMeter = () => polarUsageMeter(surface),
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
    options: McpUsageOptions = {},
  ) {
    if (plan === 'admin' || plan === 'disabled') {
      return usageSnapshot(surface, plan, 0, now)
    }
    const periodStart = meteringPeriodStart(now, options.resetAt)
    try {
      const used = await meter().readTotal({
        userId,
        periodStart,
        periodEnd: now,
      })
      // Keep the admission counter in sync. Polar's total can lag events the
      // local counter already knows about, so never let a read move it back.
      const counter = counterFor(userId, periodStart)
      counter.used = Math.max(counter.used, Math.max(0, Math.floor(used)))
      counter.readAt = now.getTime()
      return usageSnapshot(surface, plan, used, now, options.weeklyLimit)
    } catch (error) {
      if (error instanceof UsageMeterUnconfiguredError) {
        return unmeteredSnapshot(surface, now)
      }
      if (error instanceof McpUsageUnavailableError) throw error
      throw new McpUsageUnavailableError(error)
    }
  }

  async function reserve(
    userId: string,
    plan: McpUsagePlan,
    now = new Date(),
    options: McpUsageOptions = {},
  ) {
    if (plan === 'admin' || plan === 'disabled') {
      return usageSnapshot(surface, plan, 0, now)
    }
    const periodStart = meteringPeriodStart(now, options.resetAt)

    let surfaceMeter: McpUsageMeter
    try {
      surfaceMeter = meter()
    } catch (error) {
      if (error instanceof UsageMeterUnconfiguredError) {
        return unmeteredSnapshot(surface, now)
      }
      throw error
    }

    // Pro and Studio include a million calls a week — the limit is not
    // reachable in practice, so the call never waits on Polar. The event is
    // recorded in the background and the snapshot comes from the local
    // counter; the usage read still returns the real total.
    if (plan !== 'free') {
      const counter = counterFor(userId, periodStart)
      counter.used += 1
      void (async () => {
        try {
          await surfaceMeter.record({
            userId,
            eventId: crypto.randomUUID(),
            timestamp: now,
            plan,
          })
        } catch (error) {
          console.error(
            `[usage] deferred ${surface.source} usage event failed`,
            error,
          )
        }
      })()
      return usageSnapshot(surface, plan, counter.used, now, options.weeklyLimit)
    }

    // Free has a small quota, so admission stays strict: read Polar when the
    // counter is stale, count locally in between, and record before running.
    return serialized(userId, async () => {
      const counter = counterFor(userId, periodStart)
      const nowMs = now.getTime()
      if (counter.readAt === 0 || nowMs - counter.readAt > readTtlMs) {
        try {
          const used = await surfaceMeter.readTotal({
            userId,
            periodStart,
            periodEnd: now,
          })
          counter.used = Math.max(counter.used, Math.max(0, Math.floor(used)))
          counter.readAt = nowMs
        } catch (error) {
          if (error instanceof McpUsageUnavailableError) throw error
          throw new McpUsageUnavailableError(error)
        }
      }
      const usage = usageSnapshot(
        surface,
        plan,
        counter.used,
        now,
        options.weeklyLimit,
      )
      if (usage.remaining === 0) throw new McpUsageLimitError(usage)
      try {
        const inserted = await surfaceMeter.record({
          userId,
          eventId: crypto.randomUUID(),
          timestamp: now,
          plan,
        })
        if (inserted) counter.used += 1
        return usageSnapshot(
          surface,
          plan,
          counter.used,
          now,
          options.weeklyLimit,
        )
      } catch (error) {
        if (error instanceof McpUsageUnavailableError) throw error
        throw new McpUsageUnavailableError(error)
      }
    })
  }

  return { current, reserve }
}

export function createMcpUsageService(
  meter: () => McpUsageMeter = () => polarUsageMeter(MCP_USAGE_SURFACE),
  readTtlMs = USAGE_READ_TTL_MS,
) {
  return createUsageService(MCP_USAGE_SURFACE, meter, readTtlMs)
}

export function createAgentUsageService(
  meter: () => McpUsageMeter = () => polarUsageMeter(AGENT_USAGE_SURFACE),
  readTtlMs = USAGE_READ_TTL_MS,
) {
  return createUsageService(AGENT_USAGE_SURFACE, meter, readTtlMs)
}

const mcpUsageService = createMcpUsageService()
const agentUsageService = createAgentUsageService()

export const getMcpUsage = mcpUsageService.current
export const reserveMcpCall = mcpUsageService.reserve

export const getAgentUsage = agentUsageService.current
export const reserveAgentCall = agentUsageService.reserve
