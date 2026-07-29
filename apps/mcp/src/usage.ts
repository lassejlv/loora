import {
  getMcpUsage,
  reserveMcpCall,
  type McpUsagePlan,
} from '@loora/billing/mcp-usage'
import type { McpUsageController } from './server'

export function createMcpUsageController(
  userId: string,
  plan: McpUsagePlan,
): McpUsageController {
  return {
    current: () => getMcpUsage(userId, plan),
    reserve: () => reserveMcpCall(userId, plan),
  }
}
