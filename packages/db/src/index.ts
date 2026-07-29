import { SQL } from 'bun'
import { drizzle } from 'drizzle-orm/bun-sql'
import * as schema from './schema'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required')
}

function integerEnvironment(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const value = Number(process.env[name] ?? fallback)
  return Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback
}

export const databaseClient = new SQL({
  url: databaseUrl,
  max: integerEnvironment('DATABASE_POOL_MAX', 10, 1, 50),
  idleTimeout: integerEnvironment(
    'DATABASE_IDLE_TIMEOUT_SECONDS',
    30,
    1,
    600,
  ),
  maxLifetime: integerEnvironment(
    'DATABASE_MAX_LIFETIME_SECONDS',
    300,
    0,
    86_400,
  ),
  connectionTimeout: integerEnvironment(
    'DATABASE_CONNECTION_TIMEOUT_SECONDS',
    5,
    1,
    60,
  ),
  connection: {
    statement_timeout: integerEnvironment(
      'DATABASE_STATEMENT_TIMEOUT_MS',
      15_000,
      1_000,
      120_000,
    ),
  },
})

export const db = drizzle({ client: databaseClient, schema })

export async function checkDatabaseConnection(timeoutMs = 2_000) {
  const query = databaseClient`select 1 as ready`.execute()
  const timer = setTimeout(() => query.cancel(), timeoutMs)
  try {
    await query
  } finally {
    clearTimeout(timer)
  }
}
