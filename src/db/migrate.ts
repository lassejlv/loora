import { migrate } from 'drizzle-orm/neon-http/migrator'
import { db } from './index'

await migrate(db, { migrationsFolder: './drizzle' })

console.info('[database] migrations applied')
