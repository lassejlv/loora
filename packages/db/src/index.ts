import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required')
}

// Neon HTTP mode: one fetch-based request per query, with no WebSocket pool.
export const db = drizzle(databaseUrl, { schema })
