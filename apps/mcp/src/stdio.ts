// Local stdio entry — no OAuth, acts as the user named by LOORA_MCP_USER.
// Handy for development against a local database; the deployed server is the
// HTTP one in index.ts.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { resolveUser } from './user'
import { createLooraServer } from './server'
import { requireAppAccess } from './access'
import { createMcpUsageController } from './usage'

const user = await resolveUser()
const access = await requireAppAccess(user.id)
const server = createLooraServer(
  user.id,
  createMcpUsageController(user.id, access.mcpPlan),
  access.mcpPlan,
)
await server.connect(new StdioServerTransport())
// stdout is the MCP channel; anything human-facing goes to stderr.
console.error(`[loora-mcp] stdio ready as ${user.email}`)
