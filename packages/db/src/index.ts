import { Pool, neonConfig } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
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

export const databaseClient = new Pool({
  connectionString: databaseUrl,
  max: integerEnvironment('DATABASE_POOL_MAX', 10, 1, 50),
  // A Worker isolate can outlive the request that opened a socket. Retiring a
  // client when a transaction releases it prevents a later request from
  // inheriting a connection owned by the earlier request.
  maxUses: 1,
  idleTimeoutMillis:
    integerEnvironment(
      'DATABASE_IDLE_TIMEOUT_SECONDS',
      30,
      1,
      600,
    ) * 1_000,
  maxLifetimeSeconds: integerEnvironment(
    'DATABASE_MAX_LIFETIME_SECONDS',
    0,
    0,
    86_400,
  ),
  connectionTimeoutMillis:
    integerEnvironment(
      'DATABASE_CONNECTION_TIMEOUT_SECONDS',
      5,
      1,
      60,
    ) * 1_000,
  statement_timeout: integerEnvironment(
    'DATABASE_STATEMENT_TIMEOUT_MS',
    15_000,
    1_000,
    120_000,
  ),
})

// Pool.query() is the path used by Drizzle outside interactive transactions.
// Route those one-shot queries over Neon's stateless HTTP transport so they do
// not leave request-scoped WebSockets in a reused Worker isolate.
neonConfig.poolQueryViaFetch = true

export const db = drizzle({ client: databaseClient, schema })

export async function checkDatabaseConnection(timeoutMs = 2_000) {
  let timer: ReturnType<typeof setTimeout> | null = null
  await Promise.race([
    databaseClient.query('select 1 as ready'),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Database readiness check timed out')),
        timeoutMs,
      )
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}
