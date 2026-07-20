import { and, asc, eq, gt, gte, isNull, sql } from 'drizzle-orm'
import { db } from '#/db'
import { aiUsage, user } from '#/db/schema'
import { getModel, type ModelKey } from '#/lib/models'
import { creditUnitsForCost, polarIngestAcknowledged } from '#/lib/billing-policy'
import { getPolarClient } from '#/lib/polar'

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
  const [saved] = await db.insert(aiUsage).values({
    id: crypto.randomUUID(),
    userId,
    model,
    inputTokens,
    outputTokens,
    costMicroUsd: costMicroUsd(model, inputTokens, outputTokens),
  }).returning()
  return saved
}

type UsageRow = typeof aiUsage.$inferSelect

export async function reportPolarUsage(row: UsageRow) {
  if (row.creditUnits <= 0 || row.polarReportedAt) return true
  try {
    const response = await getPolarClient().events.ingest({
      events: [{
        name: 'loora.ai_usage.v1',
        externalId: row.id,
        externalCustomerId: row.userId,
        timestamp: row.createdAt,
        metadata: {
          credits: row.creditUnits,
          model: row.model,
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          costMicroUsd: row.costMicroUsd,
        },
      }],
    })
    if (!polarIngestAcknowledged(response)) throw new Error('Polar did not acknowledge usage')
    await db
      .update(aiUsage)
      .set({ polarReportedAt: new Date() })
      .where(and(eq(aiUsage.id, row.id), isNull(aiUsage.polarReportedAt)))
    return true
  } catch {
    await db
      .update(aiUsage)
      .set({ polarReportAttempts: sql`${aiUsage.polarReportAttempts} + 1` })
      .where(eq(aiUsage.id, row.id))
    return false
  }
}

export async function flushPendingPolarUsage(userId: string) {
  const pending = await db
    .select()
    .from(aiUsage)
    .where(and(
      eq(aiUsage.userId, userId),
      gt(aiUsage.creditUnits, 0),
      isNull(aiUsage.polarReportedAt),
    ))
    .orderBy(asc(aiUsage.createdAt))
    .limit(100)
  for (const row of pending) {
    if (!await reportPolarUsage(row)) return false
  }
  return true
}

export async function recordSubscriberUsage(
  userId: string,
  model: ModelKey,
  inputTokens: number,
  outputTokens: number,
) {
  const cost = costMicroUsd(model, inputTokens, outputTokens)
  const [saved] = await db
    .insert(aiUsage)
    .values({
      id: crypto.randomUUID(),
      userId,
      model,
      inputTokens,
      outputTokens,
      costMicroUsd: cost,
      creditUnits: creditUnitsForCost(cost),
    })
    .returning()
  await reportPolarUsage(saved)
  return saved
}
