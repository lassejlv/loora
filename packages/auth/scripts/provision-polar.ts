import { Polar } from '@polar-sh/sdk'
import type { Benefit } from '@polar-sh/sdk/models/components/benefit.js'
import type { Meter } from '@polar-sh/sdk/models/components/meter.js'
import type { Product } from '@polar-sh/sdk/models/components/product.js'

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const serverIndex = process.argv.indexOf('--server')
const server = serverIndex >= 0 ? process.argv[serverIndex + 1] : process.env.POLAR_SERVER
const accessToken = process.env.POLAR_ACCESS_TOKEN?.trim()

if (server !== 'production') throw new Error('Polar provisioning requires --server production')
if (!accessToken) throw new Error('POLAR_ACCESS_TOKEN is required')

const polar = new Polar({ accessToken, server: 'production' })
const catalogMetadata = { app: 'loora', catalog_version: 1 }

async function items<T>(iterator: AsyncIterable<{ result: { items: T[] } }>) {
  const found: T[] = []
  for await (const page of iterator) found.push(...page.result.items)
  return found
}

function exactMetadata(resource: { metadata: Record<string, unknown> }, kind: string) {
  return resource.metadata.app === 'loora' &&
    resource.metadata.catalog_version === 1 &&
    resource.metadata.catalog_kind === kind
}

function assertSingle<T>(resources: T[], label: string): T | null {
  if (resources.length > 1) throw new Error(`Multiple Polar resources match ${label}`)
  return resources[0] ?? null
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function findMeter() {
  const all = await items<Meter>(await polar.meters.list({
    metadata: { app: 'loora', catalog_version: 1, catalog_kind: 'ai_credits_meter' },
    limit: 100,
  }))
  return assertSingle(all.filter((item) => exactMetadata(item, 'ai_credits_meter')), 'AI credits meter')
}

async function ensureMeter() {
  const expected = {
    name: 'loora_ai_credits',
    unit: 'custom' as const,
    customLabel: 'AI credits',
    customMultiplier: 1,
    filter: { conjunction: 'and' as const, clauses: [{ property: 'name', operator: 'eq' as const, value: 'loora.ai_usage.v1' }] },
    aggregation: { func: 'sum' as const, property: 'credits' },
  }
  const found = await findMeter()
  if (found) {
    const compatible = found.name === expected.name &&
      found.unit === expected.unit && found.customLabel === expected.customLabel &&
      found.customMultiplier === expected.customMultiplier &&
      sameJson(found.filter, expected.filter) && sameJson(found.aggregation, expected.aggregation)
    if (!compatible) throw new Error('Existing AI credits meter is incompatible')
    return found.id
  }
  if (dryRun) return '<create:loora_ai_credits>'
  return (await polar.meters.create({
    ...expected,
    metadata: { ...catalogMetadata, catalog_kind: 'ai_credits_meter' },
  })).id
}

async function findBenefit(kind: string) {
  const all = await items<Benefit>(await polar.benefits.list({
    metadata: { app: 'loora', catalog_version: 1, catalog_kind: kind },
    limit: 100,
  }))
  return assertSingle(all.filter((item) => exactMetadata(item, kind)), kind)
}

async function ensureAccessBenefit() {
  const found = await findBenefit('access_benefit')
  if (found) {
    if (found.type !== 'feature_flag' || found.description !== 'loora_access' || found.visibility !== 'public') {
      throw new Error('Existing access benefit is incompatible')
    }
    return found.id
  }
  if (dryRun) return '<create:loora_access>'
  return (await polar.benefits.create({
    type: 'feature_flag',
    description: 'loora_access',
    visibility: 'public',
    properties: {},
    metadata: { ...catalogMetadata, catalog_kind: 'access_benefit' },
  })).id
}

async function ensureCreditBenefit(kind: string, description: string, units: number, meterId: string) {
  const found = await findBenefit(kind)
  if (found) {
    if (found.type !== 'meter_credit' || found.description !== description ||
      found.properties.units !== units || found.properties.rollover ||
      found.properties.meterId !== meterId) {
      throw new Error(`Existing ${description} benefit is incompatible`)
    }
    return found.id
  }
  if (dryRun) return `<create:${description}>`
  return (await polar.benefits.create({
    type: 'meter_credit',
    description,
    visibility: 'public',
    properties: { units, rollover: false, meterId },
    metadata: { ...catalogMetadata, catalog_kind: kind },
  })).id
}

function fixedPriceAmount(product: Product) {
  const fixed = product.prices.find((price) => 'amountType' in price && price.amountType === 'fixed')
  return fixed && 'priceAmount' in fixed ? fixed.priceAmount : null
}

function customPrice(product: Product) {
  return product.prices.find((price) =>
    'amountType' in price && price.amountType === 'custom' &&
    'priceCurrency' in price && price.priceCurrency === 'usd'
  )
}

async function findProduct(plan: 'pro' | 'studio') {
  const all = await items<Product>(await polar.products.list({
    metadata: { app: 'loora', plan, catalog_version: 1 },
    limit: 100,
  }))
  return assertSingle(all.filter((item) =>
    item.metadata.app === 'loora' && item.metadata.plan === plan && item.metadata.catalog_version === 1
  ), `${plan} product`)
}

async function ensureProduct(
  plan: 'pro' | 'studio',
  name: string,
  amount: number,
  benefits: string[],
  trial: { interval: 'day'; count: number } | null,
) {
  const found = await findProduct(plan)
  if (found) {
    const actualBenefits = found.benefits.map((benefit) => benefit.id).sort()
    const compatible = found.name === name && found.visibility === 'private' &&
      found.recurringInterval === 'month' && found.recurringIntervalCount === 1 &&
      fixedPriceAmount(found) === amount &&
      sameJson(actualBenefits, [...benefits].sort()) &&
      found.prices.every((price) => !('meterId' in price))
    if (!compatible) throw new Error(`Existing ${name} product is incompatible`)
    const trialMatches = found.trialInterval === (trial?.interval ?? null) &&
      found.trialIntervalCount === (trial?.count ?? null)
    if (!trialMatches) {
      if (dryRun) {
        console.error(`[dry-run] Update ${name} trial to ${trial ? `${trial.count} ${trial.interval}s` : 'disabled'}`)
      } else {
        await polar.products.update({
          id: found.id,
          productUpdate: {
            trialInterval: trial?.interval ?? null,
            trialIntervalCount: trial?.count ?? null,
          },
        })
      }
    }
    return found.id
  }
  if (dryRun) return `<create:${plan}>`
  const product = await polar.products.create({
    name,
    visibility: 'private',
    recurringInterval: 'month',
    recurringIntervalCount: 1,
    trialInterval: trial?.interval ?? null,
    trialIntervalCount: trial?.count ?? null,
    prices: [{ amountType: 'fixed', priceCurrency: 'usd', priceAmount: amount }],
    metadata: { ...catalogMetadata, plan },
  })
  await polar.products.updateBenefits({
    id: product.id,
    productBenefitsUpdate: { benefits },
  })
  return product.id
}

async function ensureTopUpProduct() {
  const all = await items<Product>(await polar.products.list({
    metadata: { ...catalogMetadata, catalog_kind: 'credit_top_up_product' },
    limit: 100,
  }))
  const found = assertSingle(
    all.filter((item) => exactMetadata(item, 'credit_top_up_product')),
    'credit top-up product',
  )
  if (found) {
    const price = customPrice(found)
    const compatible = found.name === 'Loora AI Credit Top-Up' &&
      found.visibility === 'private' && found.recurringInterval === null &&
      found.benefits.length === 0 && price &&
      'minimumAmount' in price && price.minimumAmount === 500 &&
      'maximumAmount' in price && price.maximumAmount === 50_000 &&
      'presetAmount' in price && price.presetAmount === 1_000
    if (!compatible) throw new Error('Existing Loora AI Credit Top-Up product is incompatible')
    return found.id
  }
  if (dryRun) return '<create:credit_top_up>'
  return (await polar.products.create({
    name: 'Loora AI Credit Top-Up',
    description: 'Add prepaid AI credits to your Loora account. $1 adds 10 AI credits.',
    visibility: 'private',
    recurringInterval: null,
    prices: [{
      amountType: 'custom',
      priceCurrency: 'usd',
      minimumAmount: 500,
      maximumAmount: 50_000,
      presetAmount: 1_000,
    }],
    metadata: { ...catalogMetadata, catalog_kind: 'credit_top_up_product' },
  })).id
}

const meterId = await ensureMeter()
const accessBenefitId = await ensureAccessBenefit()
const proCreditsBenefitId = await ensureCreditBenefit('pro_credits_benefit', 'loora_pro_credits', 100, meterId)
const studioCreditsBenefitId = await ensureCreditBenefit('studio_credits_benefit', 'loora_studio_credits', 300, meterId)
const proProductId = await ensureProduct(
  'pro',
  'Loora Pro',
  2000,
  [accessBenefitId, proCreditsBenefitId],
  { interval: 'day', count: 3 },
)
const studioProductId = await ensureProduct(
  'studio',
  'Loora Studio',
  4900,
  [accessBenefitId, studioCreditsBenefitId],
  null,
)
const topUpProductId = await ensureTopUpProduct()

console.log(JSON.stringify({
  POLAR_AI_METER_ID: meterId,
  POLAR_ACCESS_BENEFIT_ID: accessBenefitId,
  POLAR_PRO_PRODUCT_ID: proProductId,
  POLAR_STUDIO_PRODUCT_ID: studioProductId,
  POLAR_TOP_UP_PRODUCT_ID: topUpProductId,
}))
