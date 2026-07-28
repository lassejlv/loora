import { Polar } from '@polar-sh/sdk'
import type { Benefit } from '@polar-sh/sdk/models/components/benefit.js'
import type { Product } from '@polar-sh/sdk/models/components/product.js'

// Plan access only. Legacy AI credits meters / meter_credit benefits / top-up
// products may still exist in the Polar dashboard and can be cleaned manually.

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

function fixedPriceAmount(product: Product) {
  const fixed = product.prices.find((price) => 'amountType' in price && price.amountType === 'fixed')
  return fixed && 'priceAmount' in fixed ? fixed.priceAmount : null
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

const accessBenefitId = await ensureAccessBenefit()
const proProductId = await ensureProduct(
  'pro',
  'Loora Pro',
  2000,
  [accessBenefitId],
  { interval: 'day', count: 3 },
)
const studioProductId = await ensureProduct(
  'studio',
  'Loora Studio',
  4900,
  [accessBenefitId],
  null,
)

console.log(JSON.stringify({
  POLAR_ACCESS_BENEFIT_ID: accessBenefitId,
  POLAR_PRO_PRODUCT_ID: proProductId,
  POLAR_STUDIO_PRODUCT_ID: studioProductId,
}))
