import { Polar } from '@polar-sh/sdk'
import { getPolarRuntime } from './polar'

let client: Polar | undefined

export function getPolarClient() {
  const { config } = getPolarRuntime()
  if (!config) throw new Error('Polar is not configured')
  return client ??= new Polar({
    accessToken: config.accessToken,
    server: config.server,
    timeoutMs: 4_000,
  })
}
