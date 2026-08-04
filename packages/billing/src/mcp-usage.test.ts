import { describe, expect, test } from 'vitest'
import {
  AGENT_USAGE_EVENT,
  AGENT_USAGE_SURFACE,
  AGENT_WEEKLY_INCLUDED,
  MCP_USAGE_EVENT,
  MCP_USAGE_SURFACE,
  McpUsageLimitError,
  MCP_WEEKLY_INCLUDED,
  UsageMeterUnconfiguredError,
  createAgentUsageService,
  createMcpUsageService,
  createUsageService,
  includedAgentCalls,
  includedMcpCalls,
  mcpUsageWindow,
  resolveMcpUsagePlan,
  type McpUsageMeter,
} from './mcp-usage'

describe('MCP included usage', () => {
  test('matches the published Free and Pro weekly limits', () => {
    expect(MCP_WEEKLY_INCLUDED).toEqual({
      free: 100,
      pro: 1_000_000,
      studio: 1_000_000,
    })
    expect(includedMcpCalls('admin')).toBeNull()
    expect(includedMcpCalls('disabled')).toBeNull()
  })

  test('uses Monday-to-Monday UTC calendar weeks', () => {
    expect(mcpUsageWindow(new Date('2026-07-29T23:59:59Z'))).toEqual({
      periodStart: new Date('2026-07-27T00:00:00.000Z'),
      resetsAt: new Date('2026-08-03T00:00:00.000Z'),
    })
    expect(
      mcpUsageWindow(new Date('2026-08-02T23:59:59Z')).periodStart,
    ).toEqual(new Date('2026-07-27T00:00:00.000Z'))
    expect(
      mcpUsageWindow(new Date('2026-08-03T00:00:00Z')).periodStart,
    ).toEqual(new Date('2026-08-03T00:00:00.000Z'))
  })

  test('reads Polar totals and records one event for an admitted call', async () => {
    const reads: Parameters<McpUsageMeter['readTotal']>[0][] = []
    const records: Parameters<McpUsageMeter['record']>[0][] = []
    const meter: McpUsageMeter = {
      readTotal: async (input) => {
        reads.push(input)
        return 99
      },
      record: async (input) => {
        records.push(input)
        return true
      },
    }
    const service = createMcpUsageService(() => meter)
    const now = new Date('2026-07-29T12:00:00Z')

    const usage = await service.reserve('user-1', 'free', now)

    expect(usage).toEqual({
      metric: 'mcp_tool_calls',
      plan: 'free',
      included: 100,
      used: 100,
      remaining: 0,
      periodStart: '2026-07-27T00:00:00.000Z',
      resetsAt: '2026-08-03T00:00:00.000Z',
    })
    expect(reads).toEqual([{
      userId: 'user-1',
      periodStart: new Date('2026-07-27T00:00:00.000Z'),
      periodEnd: now,
    }])
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      userId: 'user-1',
      timestamp: now,
      plan: 'free',
    })
  })

  test('rejects at the included limit without recording another event', async () => {
    let records = 0
    const service = createMcpUsageService(() => ({
      readTotal: async () => 100,
      record: async () => {
        records += 1
        return true
      },
    }))

    await expect(
      service.reserve('user-1', 'free', new Date('2026-07-29T12:00:00Z')),
    ).rejects.toBeInstanceOf(McpUsageLimitError)
    expect(records).toBe(0)
  })

  test('honors a raised weekly limit', async () => {
    let records = 0
    const service = createMcpUsageService(() => ({
      readTotal: async () => 100,
      record: async () => {
        records += 1
        return true
      },
    }))

    const usage = await service.reserve(
      'user-1',
      'free',
      new Date('2026-07-29T12:00:00Z'),
      { weeklyLimit: 250 },
    )

    expect(usage.included).toBe(250)
    expect(usage.used).toBe(101)
    expect(usage.remaining).toBe(149)
    expect(records).toBe(1)
  })

  test('starts metering at an admin reset within the current week', async () => {
    const reads: Parameters<McpUsageMeter['readTotal']>[0][] = []
    const service = createMcpUsageService(() => ({
      readTotal: async (input) => {
        reads.push(input)
        return 0
      },
      record: async () => true,
    }))
    const resetAt = new Date('2026-07-29T11:30:00Z')
    const now = new Date('2026-07-29T12:00:00Z')

    const usage = await service.current('user-1', 'free', now, { resetAt })

    expect(reads[0]?.periodStart).toEqual(resetAt)
    expect(usage.used).toBe(0)
    expect(usage.periodStart).toBe('2026-07-27T00:00:00.000Z')
    expect(usage.resetsAt).toBe('2026-08-03T00:00:00.000Z')
  })

  test('caches Free meter reads between calls instead of reading every time', async () => {
    let reads = 0
    let records = 0
    const service = createMcpUsageService(() => ({
      readTotal: async () => {
        reads += 1
        return 10
      },
      record: async () => {
        records += 1
        return true
      },
    }))
    const now = new Date('2026-07-29T12:00:00Z')

    const first = await service.reserve('user-1', 'free', now)
    const second = await service.reserve(
      'user-1',
      'free',
      new Date(now.getTime() + 1_000),
    )
    expect(first.used).toBe(11)
    expect(second.used).toBe(12)
    expect(reads).toBe(1)
    expect(records).toBe(2)

    // Past the read TTL the counter re-syncs with Polar, keeping whichever
    // total is higher so a lagging meter cannot reopen spent quota.
    const third = await service.reserve(
      'user-1',
      'free',
      new Date(now.getTime() + 31_000),
    )
    expect(reads).toBe(2)
    expect(third.used).toBe(13)
  })

  test('does not block Pro calls on Polar at all', async () => {
    let reads = 0
    let recordedCount = 0
    const service = createMcpUsageService(() => ({
      readTotal: async () => {
        reads += 1
        return 0
      },
      record: async () => {
        recordedCount += 1
        return true
      },
    }))
    const now = new Date('2026-07-29T12:00:00Z')

    const usage = await service.reserve('pro-1', 'pro', now)
    expect(usage.plan).toBe('pro')
    expect(usage.used).toBe(1)
    expect(usage.remaining).toBe(1_000_000 - 1)
    expect(reads).toBe(0)
    // The event still lands, just off the hot path.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(recordedCount).toBe(1)
  })

  test('a failing Polar ingest does not fail a Pro call', async () => {
    const service = createMcpUsageService(() => ({
      readTotal: async () => 0,
      record: async () => {
        throw new Error('polar down')
      },
    }))

    const usage = await service.reserve(
      'pro-1',
      'pro',
      new Date('2026-07-29T12:00:00Z'),
    )
    expect(usage.used).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  test('does not contact Polar when billing is disabled or bypassed for admins', async () => {
    let calls = 0
    const service = createMcpUsageService(() => {
      calls += 1
      throw new Error('Meter should not be created')
    })

    expect((await service.current('admin-1', 'admin')).included).toBeNull()
    expect((await service.reserve('local-1', 'disabled')).included).toBeNull()
    expect(calls).toBe(0)
  })

  test('resolveMcpUsagePlan matches MCP access gates', () => {
    expect(resolveMcpUsagePlan({
      source: 'admin',
      access: true,
      plan: null,
    })).toBe('admin')
    expect(resolveMcpUsagePlan({
      source: 'disabled',
      access: true,
      plan: null,
    })).toBe('disabled')
    expect(resolveMcpUsagePlan({
      source: 'cache',
      access: true,
      plan: 'pro',
    })).toBe('pro')
    expect(resolveMcpUsagePlan({
      source: 'polar',
      access: false,
      plan: 'pro',
    })).toBeNull()
    expect(resolveMcpUsagePlan({
      source: 'cache',
      access: true,
      plan: null,
    })).toBeNull()
  })
})

describe('two separate meters', () => {
  function countingMeter() {
    const records: Parameters<McpUsageMeter['record']>[0][] = []
    let total = 0
    const meter: McpUsageMeter = {
      readTotal: async () => total,
      record: async (input) => {
        records.push(input)
        total += 1
        return true
      },
    }
    return { meter, records, used: () => total }
  }

  test('the agent has its own allowance, not MCP’s', () => {
    expect(AGENT_WEEKLY_INCLUDED.free).not.toBe(MCP_WEEKLY_INCLUDED.free)
    expect(includedAgentCalls('free')).toBe(AGENT_WEEKLY_INCLUDED.free)
    expect(includedMcpCalls('free')).toBe(MCP_WEEKLY_INCLUDED.free)
    expect(includedAgentCalls('admin')).toBeNull()
  })

  test('the two surfaces are different Polar events', () => {
    expect(AGENT_USAGE_EVENT).not.toBe(MCP_USAGE_EVENT)
    expect(AGENT_USAGE_SURFACE.metric).toBe('agent_tool_calls')
    expect(MCP_USAGE_SURFACE.metric).toBe('mcp_tool_calls')
  })

  test('agent calls land on the agent meter and are labelled as such', async () => {
    const agent = countingMeter()
    const service = createAgentUsageService(() => agent.meter)
    const now = new Date('2026-07-29T12:00:00Z')

    const usage = await service.reserve('user-1', 'free', now)

    expect(usage.metric).toBe('agent_tool_calls')
    expect(usage.included).toBe(AGENT_WEEKLY_INCLUDED.free)
    expect(agent.records).toHaveLength(1)
  })

  test('spending one surface does not spend the other', async () => {
    const mcp = countingMeter()
    const agent = countingMeter()
    const mcpService = createMcpUsageService(() => mcp.meter)
    const agentService = createAgentUsageService(() => agent.meter)
    const now = new Date('2026-07-29T12:00:00Z')

    for (let call = 0; call < 5; call += 1) {
      await agentService.reserve('user-1', 'free', now)
    }
    const mcpUsage = await mcpService.reserve('user-1', 'free', now)

    expect(agent.used()).toBe(5)
    expect(mcp.used()).toBe(1)
    expect(mcpUsage.used).toBe(1)
    expect(mcpUsage.remaining).toBe(MCP_WEEKLY_INCLUDED.free - 1)
  })

  test('exhausting the agent leaves MCP alone', async () => {
    const mcp = countingMeter()
    const agentService = createUsageService(
      { ...AGENT_USAGE_SURFACE, included: { free: 1, pro: 1, studio: 1 } },
      () => countingMeter().meter,
    )
    const mcpService = createMcpUsageService(() => mcp.meter)
    const now = new Date('2026-07-29T12:00:00Z')

    await agentService.reserve('user-1', 'free', now)
    await expect(
      agentService.reserve('user-1', 'free', now),
    ).rejects.toBeInstanceOf(McpUsageLimitError)

    await expect(
      mcpService.reserve('user-1', 'free', now),
    ).resolves.toMatchObject({ metric: 'mcp_tool_calls', used: 1 })
  })

  test('names the surface that ran out', async () => {
    const agentService = createUsageService(
      { ...AGENT_USAGE_SURFACE, included: { free: 0, pro: 0, studio: 0 } },
      () => countingMeter().meter,
    )
    await expect(
      agentService.reserve('user-1', 'free', new Date('2026-07-29T12:00:00Z')),
    ).rejects.toThrow(/Weekly agent limit reached/)
  })

  test('an unprovisioned meter reports unmetered instead of blocking', async () => {
    const service = createUsageService(
      { ...AGENT_USAGE_SURFACE, meterId: () => null },
      () => {
        throw new UsageMeterUnconfiguredError(AGENT_USAGE_SURFACE)
      },
    )
    const now = new Date('2026-07-29T12:00:00Z')

    await expect(service.reserve('user-1', 'free', now)).resolves.toMatchObject({
      metric: 'agent_tool_calls',
      plan: 'disabled',
      included: null,
      remaining: null,
    })
    await expect(service.current('user-1', 'free', now)).resolves.toMatchObject({
      included: null,
    })
  })
})
