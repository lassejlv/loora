import { and, asc, eq, gte, sql } from 'drizzle-orm'
import { db } from '#/db'
import { aiUsage, user } from '#/db/schema'
import type { ModelKey } from '#/lib/models'

// USD per 1M tokens. Server-only — never ship to the client.
// A price of $X per 1M tokens equals X micro-USD per token, so cost math stays integer.
const PRICES: Record<ModelKey, { input: number; output: number }> = {
  mini: { input: 1.2, output: 4.9 },
  max: { input: 1.5, output: 4.2 },
  'max-fast': { input: 4, output: 12 },
}

export const DAILY_LIMIT_USD = 0.5
export const WEEKLY_LIMIT_USD = 2

const MICRO = 1_000_000

export function costMicroUsd(model: ModelKey, inputTokens: number, outputTokens: number) {
  const price = PRICES[model]
  return Math.round(inputTokens * price.input + outputTokens * price.output)
}

// Rolling windows: last 24h and last 7d.
export async function getUsage(userId: string) {
  const now = Date.now()
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000)
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000)
  const [row] = await db
    .select({
      daily: sql<number>`coalesce(sum(${aiUsage.costMicroUsd}) filter (where ${aiUsage.createdAt} >= ${dayAgo}), 0)::bigint`,
      weekly: sql<number>`coalesce(sum(${aiUsage.costMicroUsd}), 0)::bigint`,
    })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, weekAgo)))
  return {
    dailyUsd: Number(row?.daily ?? 0) / MICRO,
    weeklyUsd: Number(row?.weekly ?? 0) / MICRO,
  }
}

export async function listUserUsage() {
  const now = Date.now()
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000)
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000)
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      isAdmin: user.isAdmin,
      daily: sql<number>`coalesce(sum(${aiUsage.costMicroUsd}) filter (where ${aiUsage.createdAt} >= ${dayAgo}), 0)::bigint`,
      weekly: sql<number>`coalesce(sum(${aiUsage.costMicroUsd}), 0)::bigint`,
    })
    .from(user)
    .leftJoin(
      aiUsage,
      and(eq(aiUsage.userId, user.id), gte(aiUsage.createdAt, weekAgo)),
    )
    .groupBy(user.id)
    .orderBy(asc(user.email))

  return rows.map(({ daily, weekly, ...account }) => ({
    ...account,
    dailyUsd: Number(daily) / MICRO,
    weeklyUsd: Number(weekly) / MICRO,
  }))
}

export async function resetUsage(userId: string) {
  const deleted = await db
    .delete(aiUsage)
    .where(eq(aiUsage.userId, userId))
    .returning({ id: aiUsage.id })

  return deleted.length
}

export async function checkLimits(userId: string): Promise<string | null> {
  const usage = await getUsage(userId)
  if (usage.dailyUsd >= DAILY_LIMIT_USD) {
    return 'Daily AI limit reached. It resets as usage from the last 24 hours ages out.'
  }
  if (usage.weeklyUsd >= WEEKLY_LIMIT_USD) {
    return 'Weekly AI limit reached. It resets as usage from the last 7 days ages out.'
  }
  return null
}

export async function recordUsage(
  userId: string,
  model: ModelKey,
  inputTokens: number,
  outputTokens: number,
) {
  await db.insert(aiUsage).values({
    id: crypto.randomUUID(),
    userId,
    model,
    inputTokens,
    outputTokens,
    costMicroUsd: costMicroUsd(model, inputTokens, outputTokens),
  })
}
