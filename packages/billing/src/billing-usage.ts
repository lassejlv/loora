import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from '@loora/db'
import { aiUsage } from '@loora/db/schema'
import { polarIngestAcknowledged } from './billing-policy'
import { getPolarClient } from './polar'

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
