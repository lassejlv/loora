import {
  getAgentUsage,
  getMcpUsage,
  reserveAgentCall,
  reserveMcpCall,
  type McpUsageOptions,
  type McpUsagePlan,
} from '@loora/billing/mcp-usage'
import type { McpUsageController } from './mcp-server'

/**
 * The tool executor takes a usage controller and never asks which meter is
 * behind it — that is the whole point. MCP requests build the MCP one, the
 * in-app agent builds the agent one, and neither can spend the other's
 * allowance.
 */
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

export function createAgentUsageController(
  userId: string,
  plan: McpUsagePlan,
  options: McpUsageOptions = {},
): McpUsageController {
  return {
    current: () => getAgentUsage(userId, plan, new Date(), options),
    reserve: () => reserveAgentCall(userId, plan, new Date(), options),
  }
}
