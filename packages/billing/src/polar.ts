import { Polar } from '@polar-sh/sdk'

export type PolarServer = 'production' | 'sandbox'

export interface PolarConfig {
  server: PolarServer
  accessToken: string
  webhookSecret: string
  proProductId: string
  studioProductId: string
  topUpProductId: string
  accessBenefitId: string
  aiMeterId: string
  origin: string
}

export function isPolarBillingRequired(
  value: string | null | undefined = process.env.REQUIRE_POLAR_BILLING,
) {
  return value?.trim().toLowerCase() !== 'false'
}

export function resolvePolarConfig(
  env: Record<string, string | undefined> = process.env,
): { required: boolean; config: PolarConfig | null } {
  const required = isPolarBillingRequired(env.REQUIRE_POLAR_BILLING ?? null)
  const names = [
    'POLAR_SERVER',
    'POLAR_ACCESS_TOKEN',
    'POLAR_WEBHOOK_SECRET',
    'POLAR_PRO_PRODUCT_ID',
    'POLAR_STUDIO_PRODUCT_ID',
    'POLAR_TOP_UP_PRODUCT_ID',
    'POLAR_ACCESS_BENEFIT_ID',
    'POLAR_AI_METER_ID',
    'BETTER_AUTH_URL',
  ] as const
  const values = Object.fromEntries(names.map((name) => [name, env[name]?.trim()])) as Record<
    typeof names[number],
    string | undefined
  >
  const missing = names.filter((name) => !values[name])

  if (missing.length > 0) {
    if (required) throw new Error(`Missing required Polar configuration: ${missing.join(', ')}`)
    return { required, config: null }
  }
  if (values.POLAR_SERVER !== 'production' && values.POLAR_SERVER !== 'sandbox') {
    throw new Error('POLAR_SERVER must be production or sandbox')
  }

  let origin: string
  try {
    origin = new URL(values.BETTER_AUTH_URL!).origin
  } catch {
    throw new Error('BETTER_AUTH_URL must be an absolute URL')
  }

  return {
    required,
    config: {
      server: values.POLAR_SERVER,
      accessToken: values.POLAR_ACCESS_TOKEN!,
      webhookSecret: values.POLAR_WEBHOOK_SECRET!,
      proProductId: values.POLAR_PRO_PRODUCT_ID!,
      studioProductId: values.POLAR_STUDIO_PRODUCT_ID!,
      topUpProductId: values.POLAR_TOP_UP_PRODUCT_ID!,
      accessBenefitId: values.POLAR_ACCESS_BENEFIT_ID!,
      aiMeterId: values.POLAR_AI_METER_ID!,
      origin,
    },
  }
}

let cached: { required: boolean; config: PolarConfig | null } | undefined
let client: Polar | undefined

export function getPolarRuntime() {
  return cached ??= resolvePolarConfig()
}

export function getPolarClient() {
  const { config } = getPolarRuntime()
  if (!config) throw new Error('Polar is not configured')
  return client ??= new Polar({
    accessToken: config.accessToken,
    server: config.server,
    timeoutMs: 4_000,
  })
}
