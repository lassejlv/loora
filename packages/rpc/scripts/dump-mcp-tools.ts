/**
 * Writes the registered MCP tool manifest to `crates/mcp-server/src/tools.json`,
 * which the Rust transport serves verbatim for `tools/list`. `mcp-server.test.ts`
 * asserts the two match, so run this after changing any tool's schema,
 * description, or annotations.
 *
 *   bun run mcp:tools
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createLooraServer } from '../src/mcp-server'

const usage = {
  metric: 'mcp_tool_calls' as const,
  plan: 'free' as const,
  included: 200,
  used: 0,
  remaining: 200,
  periodStart: '2026-07-27T00:00:00.000Z',
  resetsAt: '2026-08-03T00:00:00.000Z',
}

const target = new URL(
  '../../../crates/mcp-server/src/tools.json',
  import.meta.url,
)

const server = createLooraServer(
  'user-manifest',
  { current: async () => usage, reserve: async () => usage },
  'free',
)
const client = new Client({ name: 'loora-manifest', version: '1.0.0' })
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
await server.connect(serverTransport)
await client.connect(clientTransport)

const { tools } = await client.listTools()
await Bun.write(target, `${JSON.stringify(tools, null, 2)}\n`)
console.log(`Wrote ${tools.length} tools to ${target.pathname}`)

await client.close()
await server.close()
