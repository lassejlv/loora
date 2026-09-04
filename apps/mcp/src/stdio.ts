import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { configFrom } from './config'
import { callInternal } from './internal'
import {
  advertisedTools,
  normalizeJsonArguments,
  validateToolArguments,
  type JsonValue,
} from './tools'

const selector = process.env.LOORA_MCP_USER?.trim()
if (!selector) {
  console.error('LOORA_MCP_USER is required in stdio mode')
  process.exit(1)
}

const config = configFrom((key) => process.env[key])
const account = (await callInternal(
  config,
  { action: 'resolveUser', selector },
  fetch,
)) as { id?: unknown; email?: unknown }
if (typeof account.id !== 'string' || account.id.length === 0) {
  throw new Error('Internal MCP service did not return a user id')
}
const userId = account.id
const label = typeof account.email === 'string' ? account.email : userId
console.error(`[loora-mcp] stdio ready as ${label}`)

const server = new Server(
  { name: 'loora', version: '0.3.0' },
  { capabilities: { tools: { listChanged: true } } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: advertisedTools,
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name
  const raw = (request.params.arguments ?? {}) as JsonValue
  const args: JsonValue =
    raw && typeof raw === 'object' ? structuredClone(raw) : {}
  normalizeJsonArguments(args)
  const invalid = validateToolArguments(name, args)
  if (invalid) {
    return {
      content: [
        { type: 'text', text: `Invalid arguments for tool ${name}: ${invalid}` },
      ],
      isError: true,
    }
  }
  try {
    return (await callInternal(
      config,
      { action: 'execute', userId, tool: name, arguments: args },
      fetch,
    )) as {
      content: Array<{ type: string; text?: string }>
      isError?: boolean
    }
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    return {
      content: [{ type: 'text', text }],
      isError: true,
    }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
