import '@tanstack/react-start'
import { timingSafeEqual } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { eq, or } from 'drizzle-orm'
import { db } from '@loora/db'
import { checkDatabaseConnection } from '@loora/db'
import { user } from '@loora/db/schema'
import { createLooraToolExecutor } from '@loora/rpc/mcp-server'
import { AccessDeniedError, requireAppAccess } from '@loora/rpc/mcp-access'
import { createMcpUsageController } from '@loora/rpc/mcp-usage'

type InternalRequest =
  | { action: 'ready' }
  | { action: 'access'; userId: string }
  | { action: 'execute'; userId: string; tool: string; arguments?: unknown }
  | { action: 'resolveUser'; selector: string }

function authorized(request: Request) {
  const configured = process.env.MCP_INTERNAL_TOKEN?.trim()
  const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
  if (!configured) return false
  const expected = Buffer.from(configured)
  const actual = Buffer.from(supplied)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

async function resolveUser(selector: string) {
  const [found] = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(or(eq(user.id, selector), eq(user.email, selector)))
    .limit(1)
  if (!found) throw new Error(`LOORA_MCP_USER did not match a user: ${selector}`)
  return found
}

export async function internalMcpResponse(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  let input: InternalRequest
  try {
    input = await request.json() as InternalRequest
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    if (input.action === 'ready') {
      await checkDatabaseConnection()
      return Response.json({ ready: true }, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (input.action === 'resolveUser') {
      const account = await resolveUser(input.selector.trim())
      await requireAppAccess(account.id)
      return Response.json(account, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (input.action === 'access') {
      await requireAppAccess(input.userId)
      return Response.json({ allowed: true }, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (input.action === 'execute') {
      const access = await requireAppAccess(input.userId)
      const execute = createLooraToolExecutor(
        input.userId,
        createMcpUsageController(input.userId, access.mcpPlan, access.mcpUsageOptions),
        async () => (await requireAppAccess(input.userId)).mcpPlan,
      )
      return Response.json(
        await execute(input.tool, input.arguments ?? {}),
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal MCP request failed'
    return Response.json(
      { error: message },
      {
        status: error instanceof AccessDeniedError ? 403 : 400,
        headers: { 'Cache-Control': 'no-store' },
      },
    )
  }
}

export const Route = createFileRoute('/api/internal/mcp')({
  server: {
    handlers: {
      POST: ({ request }) => internalMcpResponse(request),
    },
  },
})
