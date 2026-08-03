import { os } from '@orpc/server'
import { db } from '@loora/db'
import { launchWeek } from '@loora/db/schema'
import { adminProcedure, type ORPCContext } from './procedures'
import {
  LAUNCH_WEEK_ID,
  defaultLaunchWeekConfig,
  launchWeekConfigSchema,
  publicLaunchWeek,
} from './launch-week-shared'

async function readLaunchWeek() {
  const row = await db.query.launchWeek.findFirst({
    where: (table, { eq }) => eq(table.id, LAUNCH_WEEK_ID),
  })
  return row ? launchWeekConfigSchema.parse(row) : defaultLaunchWeekConfig()
}

export const getPublicLaunchWeek = os.$context<ORPCContext>().handler(async () => {
  const config = await readLaunchWeek()
  return publicLaunchWeek(config, new Date())
})

export const adminGetLaunchWeek = adminProcedure.handler(readLaunchWeek)

export const adminSaveLaunchWeek = adminProcedure
  .input(launchWeekConfigSchema)
  .handler(async ({ input }) => {
    const [saved] = await db
      .insert(launchWeek)
      .values({ id: LAUNCH_WEEK_ID, ...input })
      .onConflictDoUpdate({ target: launchWeek.id, set: input })
      .returning()
    return launchWeekConfigSchema.parse(saved)
  })
