import { describe, expect, test } from 'bun:test'
import { readWsConfig, WsConfigError } from './config'

const SECRET = 'x'.repeat(32)

describe('ws config', () => {
  test('reads the shared secrets and the bus', () => {
    expect(
      readWsConfig({
        PORT: '4200',
        REALTIME_TICKET_SECRET: SECRET,
        REALTIME_INTERNAL_TOKEN: SECRET,
        REDIS_URL: 'redis://localhost:6379',
        REALTIME_ALLOWED_ORIGINS: 'https://loora.design, http://localhost:3000/',
      }),
    ).toEqual({
      port: 4200,
      ticketSecret: SECRET,
      internalToken: SECRET,
      redisUrl: 'redis://localhost:6379',
      allowedOrigins: ['https://loora.design', 'http://localhost:3000'],
    })
  })

  test('falls back to the auth origin, and to a single process without Redis', () => {
    const config = readWsConfig({
      REALTIME_TICKET_SECRET: SECRET,
      REALTIME_INTERNAL_TOKEN: SECRET,
      BETTER_AUTH_URL: 'http://localhost:3000',
    })

    expect(config.redisUrl).toBeNull()
    expect(config.allowedOrigins).toEqual(['http://localhost:3000'])
    expect(config.port).toBe(4200)
  })

  test('refuses to start without credentials it can trust', () => {
    expect(() => readWsConfig({ REALTIME_INTERNAL_TOKEN: SECRET })).toThrow(
      WsConfigError,
    )
    expect(() =>
      readWsConfig({
        REALTIME_TICKET_SECRET: SECRET,
        REALTIME_INTERNAL_TOKEN: 'too-short',
      }),
    ).toThrow(WsConfigError)
  })
})
