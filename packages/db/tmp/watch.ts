import { db } from '../src/index.ts'
import { sql } from 'drizzle-orm'

for (let attempt = 0; attempt < 30; attempt += 1) {
  const [row] = (await db.execute(sql`
    select count(*) filter (where canvas_version = 2) as migrated,
           count(*) filter (where canvas_migration_lease_id is not null) as leased,
           count(*) as total
    from design
  `)) as unknown as any[]
  const state = row ?? {}
  if (Number(state.migrated) > 0) {
    console.log('DONE', JSON.stringify(state))
    process.exit(0)
  }
  if (attempt === 0 || Number(state.leased) > 0) {
    console.log('waiting', JSON.stringify(state))
  }
  await new Promise((resolve) => setTimeout(resolve, 3000))
}
console.log('TIMEOUT: nothing migrated yet')
process.exit(0)
