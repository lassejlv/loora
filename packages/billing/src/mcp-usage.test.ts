import { describe, expect, test } from 'vitest'
import {
  McpUsageLimitError,
  MCP_WEEKLY_INCLUDED,
  createMcpUsageService,
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
