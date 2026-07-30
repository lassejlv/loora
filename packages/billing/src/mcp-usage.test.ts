import { describe, expect, test } from 'bun:test'
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
      free: 200,
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
        return 199
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
      included: 200,
      used: 200,
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
      readTotal: async () => 200,
      record: async () => {
        records += 1
        return true
      },
    }))

    expect(
      service.reserve('user-1', 'free', new Date('2026-07-29T12:00:00Z')),
    ).rejects.toBeInstanceOf(McpUsageLimitError)
    expect(records).toBe(0)
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
