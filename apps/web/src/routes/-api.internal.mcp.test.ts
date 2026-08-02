import { afterEach, expect, test } from 'vitest'
import { internalMcpResponse } from './api.internal.mcp'

const originalToken = process.env.MCP_INTERNAL_TOKEN

afterEach(() => {
  if (originalToken === undefined) delete process.env.MCP_INTERNAL_TOKEN
  else process.env.MCP_INTERNAL_TOKEN = originalToken
})

test('internal MCP execution rejects callers without the shared secret', async () => {
  process.env.MCP_INTERNAL_TOKEN = 'internal-test-secret'
  const response = await internalMcpResponse(new Request('http://localhost/api/internal/mcp', {
    method: 'POST',
    body: JSON.stringify({ action: 'ready' }),
  }))
  expect(response.status).toBe(401)
})
