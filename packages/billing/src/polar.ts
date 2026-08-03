export type PolarServer = 'production' | 'sandbox'

export interface PolarConfig {
  server: PolarServer
  accessToken: string
  webhookSecret: string
  freeProductId: string
  proProductId: string
  proYearlyProductId: string
  studioProductId: string | null
  mcpMeterId: string
  accessBenefitId: string
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
    'POLAR_FREE_PRODUCT_ID',
    'POLAR_PRO_PRODUCT_ID',
    'POLAR_PRO_YEARLY_PRODUCT_ID',
    'POLAR_MCP_METER_ID',
    'POLAR_ACCESS_BENEFIT_ID',
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
    origin = new URL(env.APP_ORIGIN?.trim() || values.BETTER_AUTH_URL!).origin
  } catch {
    throw new Error('APP_ORIGIN or BETTER_AUTH_URL must be an absolute URL')
  }

  return {
    required,
    config: {
      server: values.POLAR_SERVER,
      accessToken: values.POLAR_ACCESS_TOKEN!,
      webhookSecret: values.POLAR_WEBHOOK_SECRET!,
      freeProductId: values.POLAR_FREE_PRODUCT_ID!,
      proProductId: values.POLAR_PRO_PRODUCT_ID!,
      proYearlyProductId: values.POLAR_PRO_YEARLY_PRODUCT_ID!,
      studioProductId: env.POLAR_STUDIO_PRODUCT_ID?.trim() || null,
      mcpMeterId: values.POLAR_MCP_METER_ID!,
      accessBenefitId: values.POLAR_ACCESS_BENEFIT_ID!,
      origin,
    },
  }
}

let cached: { required: boolean; config: PolarConfig | null } | undefined

export function getPolarRuntime() {
  return cached ??= resolvePolarConfig()
}
