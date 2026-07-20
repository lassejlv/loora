import { eq } from 'drizzle-orm'
import { db } from '@loora/db'
import { user } from '@loora/db/schema'

// The MCP server has no browser session; it acts as one fixed user picked by
// env. LOORA_MCP_USER accepts an email or a user id so local setup stays a
// one-liner. Resolved once and cached — a stdio server lives per client.
let resolved: { id: string; email: string } | null = null

export async function resolveUser(): Promise<{ id: string; email: string }> {
  if (resolved) return resolved
  const selector = process.env.LOORA_MCP_USER?.trim()
  if (!selector) {
    throw new Error('LOORA_MCP_USER is required (user email or user id)')
  }

  const where = selector.includes('@') ? eq(user.email, selector) : eq(user.id, selector)
  const [found] = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(where)
    .limit(1)

  if (!found) throw new Error(`No user matches LOORA_MCP_USER="${selector}"`)
  resolved = found
  return found
}
