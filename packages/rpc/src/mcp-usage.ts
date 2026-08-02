import {
  getMcpUsage,
  reserveMcpCall,
  type McpUsageOptions,
  type McpUsagePlan,
} from '@loora/billing/mcp-usage'
import type { McpUsageController } from './mcp-server'

export function createMcpUsageController(
  userId: string,
  plan: McpUsagePlan,
  options: McpUsageOptions = {},
): McpUsageController {
  return {
    current: () => getMcpUsage(userId, plan, new Date(), options),
    reserve: () => reserveMcpCall(userId, plan, new Date(), options),
  }
}
