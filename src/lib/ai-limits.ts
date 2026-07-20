import { and, asc, eq, gte, sql } from 'drizzle-orm'
import { db } from '#/db'
import { aiUsage, user } from '#/db/schema'
import { getModel, type ModelKey } from '#/lib/models'

export const DAILY_LIMIT_USD = 0.5
export const WEEKLY_LIMIT_USD = 2

const MICRO = 1_000_000

export function costMicroUsd(model: ModelKey, inputTokens: number, outputTokens: number) {
  // A price of $X per 1M tokens equals X micro-USD per token.
  const price = getModel(model).price
  return Math.round(inputTokens * price.input + outputTokens * price.output)
}

// Rolling windows: last 24h and last 7d.
export async function getUsageStatus(userId: string) {
  const now = Date.now()
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000)
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000)
  const [row] = await db
    .select({
      usageMultiplier: user.usageMultiplier,
      daily: sql<number>`coalesce(sum(${aiUsage.costMicroUsd}) filter (where ${aiUsage.createdAt} >= ${dayAgo}), 0)::bigint`,
      weekly: sql<number>`coalesce(sum(${aiUsage.costMicroUsd}), 0)::bigint`,
    })
    .from(user)
    .leftJoin(
      aiUsage,
      and(eq(aiUsage.userId, user.id), gte(aiUsage.createdAt, weekAgo)),
    )
    .where(eq(user.id, userId))
    .groupBy(user.id)

  const usageMultiplier = row?.usageMultiplier ?? 1
  return {
    dailyUsd: Number(row?.daily ?? 0) / MICRO,
    weeklyUsd: Number(row?.weekly ?? 0) / MICRO,
    usageMultiplier,
    dailyLimitUsd: DAILY_LIMIT_USD * usageMultiplier,
    weeklyLimitUsd: WEEKLY_LIMIT_USD * usageMultiplier,
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
      previewAccess: user.previewAccess,
      previewAccessRequestedAt: user.previewAccessRequestedAt,
      usageMultiplier: user.usageMultiplier,
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
    dailyLimitUsd: DAILY_LIMIT_USD * account.usageMultiplier,
    weeklyLimitUsd: WEEKLY_LIMIT_USD * account.usageMultiplier,
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
  const usage = await getUsageStatus(userId)
  if (usage.dailyUsd >= usage.dailyLimitUsd) {
    return 'Daily AI limit reached. It resets as usage from the last 24 hours ages out.'
  }
  if (usage.weeklyUsd >= usage.weeklyLimitUsd) {
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
