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
const catalogMetadata = { app: 'loora', catalog_version: 2 }

type BillingCycle = 'month' | 'year'

interface BenefitSpec {
  key: string
  description: string
  note: string
}

interface ProductSpec {
  plan: 'free' | 'pro'
  billingCycle: BillingCycle
  name: string
  description: string
  amount: number
  benefitIds: string[]
}

const commonBenefits: BenefitSpec[] = [
  {
    key: 'canvas_editor',
    description: 'Canvas editor',
    note: 'Infinite canvas, components, tokens, and breakpoints.',
  },
  {
    key: 'mcp_server',
    description: 'MCP server',
    note: 'Drive the same document from an external agent.',
  },
  {
    key: 'exports',
    description: 'HTML/CSS, React/TSX, JSON, PNG exports',
    note: 'One-way code, document, and image exports.',
  },
  {
    key: 'integrations',
    description: 'GitHub read access',
    note: 'Connect GitHub repositories for read-only context.',
  },
]

const freeBenefits: BenefitSpec[] = [
  {
    key: 'design_files_50',
    description: '50 design files',
    note: 'Create and keep up to 50 design files.',
  },
  {
    key: 'asset_storage_1_gb',
    description: '1 GB asset storage',
    note: 'Store up to 1 GB of images and files.',
  },
  {
    key: 'mcp_calls_200_week',
    description: '200 MCP calls / week',
    note: 'Weekly allowance that resets every week.',
  },
  {
    key: 'version_history_2_days',
    description: '2 days of version history',
    note: 'Rolling two-day version history window.',
  },
  {
    key: 'branches_1_open',
    description: '1 open branch per design',
    note: 'Keep one active or proposed branch per design at a time.',
  },
]

// Weekly MCP allowances stay as public product benefits and are enforced from
// this meter's Monday-to-Monday quantities. Polar meter-credit benefits refill
// on the subscription billing cycle, which would make yearly Pro incorrect.
const proBenefits: BenefitSpec[] = [
  {
    key: 'design_files_unlimited',
    description: 'Unlimited design files',
    note: 'No design file limit.',
  },
  {
    key: 'asset_storage_100_gb',
    description: '100 GB asset storage',
    note: 'Store up to 100 GB of images and files.',
  },
  {
    key: 'mcp_calls_1m_week',
    description: '1,000,000 MCP calls / week',
    note: 'Weekly allowance that resets every week.',
  },
  {
    key: 'version_history_90_days',
    description: '90 days of version history',
    note: 'Rolling 90-day version history window.',
  },
  {
    key: 'branches',
    description: 'Unlimited branches: fork, compare, merge',
    note: 'Create as many branches as you need; compare and merge freely.',
  },
  {
    key: 'in_app_agent',
    description: 'In-app agent access',
    note: 'Use the Loora agent inside the app.',
  },
  {
    key: 'image_generation',
    description: 'Image generation',
    note: 'Generate images without per-generation billing.',
  },
]

const freeDescription = [
  'Enough to build something real before you pay for anything.',
  '',
  '- 50 design files',
  '- 1 GB asset storage',
  '- 200 MCP calls per week',
  '- 2 days of version history',
  '- 1 open branch per design',
  '- Full canvas editor, MCP server, exports, and integrations',
].join('\n')

const proDescription = [
  'Everything in Free, at production limits.',
  '',
  '- Unlimited design files',
  '- 100 GB asset storage',
  '- 1,000,000 MCP calls per week',
  '- 90 days of version history',
  '- Unlimited branches: fork, compare, merge',
  '- In-app agent access',
  '- Image generation',
].join('\n')

async function items<T>(iterator: AsyncIterable<{ result: { items: T[] } }>) {
  const found: T[] = []
  for await (const page of iterator) found.push(...page.result.items)
  return found
}

function assertSingle<T>(resources: T[], label: string): T | null {
  if (resources.length > 1) throw new Error(`Multiple Polar resources match ${label}`)
  return resources[0] ?? null
}

function sameIds(left: string[], right: string[]) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function logChange(message: string) {
  console.error(`${dryRun ? '[dry-run] ' : ''}${message}`)
}

const mcpMeterDefinition = {
  name: 'loora_mcp_calls',
  unit: 'custom' as const,
  customLabel: 'MCP calls',
  customMultiplier: 1,
  filter: {
    conjunction: 'and' as const,
    clauses: [{
      property: 'name',
      operator: 'eq' as const,
      value: 'loora.mcp_call.v1',
    }],
  },
  aggregation: { func: 'count' as const },
  metadata: {
    ...catalogMetadata,
    catalog_kind: 'mcp_calls_meter',
  },
}

async function findMcpMeter() {
  const all = await items<Meter>(await polar.meters.list({
    metadata: { app: 'loora', catalog_kind: 'mcp_calls_meter' },
    limit: 100,
  }))
  return assertSingle(all.filter((meter) =>
    meter.metadata.app === 'loora' &&
    meter.metadata.catalog_kind === 'mcp_calls_meter'
  ), 'MCP calls meter')
}

async function ensureMcpMeter() {
  const found = await findMcpMeter()
  if (!found) {
    logChange('Create MCP calls meter')
    if (dryRun) return '<create:loora_mcp_calls>'
    return (await polar.meters.create(mcpMeterDefinition)).id
  }

  const compatible =
    found.name === mcpMeterDefinition.name &&
    found.unit === mcpMeterDefinition.unit &&
    found.customLabel === mcpMeterDefinition.customLabel &&
    found.customMultiplier === mcpMeterDefinition.customMultiplier &&
    sameJson(found.filter, mcpMeterDefinition.filter) &&
    sameJson(found.aggregation, mcpMeterDefinition.aggregation) &&
    found.metadata.catalog_version === catalogMetadata.catalog_version &&
    !found.archivedAt
  if (!compatible) {
    logChange('Update MCP calls meter')
    if (!dryRun) {
      await polar.meters.update({
        id: found.id,
        meterUpdate: {
          ...mcpMeterDefinition,
          isArchived: false,
        },
      })
    }
  }
  return found.id
}

async function findAccessBenefit() {
  const all = await items<Benefit>(await polar.benefits.list({
    metadata: { app: 'loora', catalog_kind: 'access_benefit' },
    limit: 100,
  }))
  return assertSingle(all.filter((benefit) =>
    benefit.metadata.app === 'loora' &&
    benefit.metadata.catalog_kind === 'access_benefit' &&
    !benefit.isDeleted
  ), 'access benefit')
}

async function ensureAccessBenefit() {
  const metadata = { ...catalogMetadata, catalog_kind: 'access_benefit' }
  const found = await findAccessBenefit()
  if (!found) {
    logChange('Create internal Loora access benefit')
    if (dryRun) return '<create:loora_access>'
    return (await polar.benefits.create({
      type: 'feature_flag',
      description: 'loora_access',
      visibility: 'private',
      properties: {},
      metadata,
    })).id
  }
  if (found.type !== 'feature_flag') throw new Error('Existing access benefit is incompatible')
  if (
    found.description !== 'loora_access' ||
    found.visibility !== 'private' ||
    found.metadata.catalog_version !== catalogMetadata.catalog_version
  ) {
    logChange('Update internal Loora access benefit')
    if (!dryRun) {
      await polar.benefits.update({
        id: found.id,
        requestBody: {
          type: 'feature_flag',
          description: 'loora_access',
          visibility: 'private',
          properties: {},
          metadata,
        },
      })
    }
  }
  return found.id
}

async function findPlanBenefit(key: string) {
  const all = await items<Benefit>(await polar.benefits.list({
    metadata: {
      app: 'loora',
      catalog_kind: 'plan_benefit',
      entitlement_key: key,
    },
    limit: 100,
  }))
  return assertSingle(all.filter((benefit) =>
    benefit.metadata.app === 'loora' &&
    benefit.metadata.catalog_kind === 'plan_benefit' &&
    benefit.metadata.entitlement_key === key &&
    !benefit.isDeleted
  ), `plan benefit ${key}`)
}

async function ensurePlanBenefit(spec: BenefitSpec) {
  const metadata = {
    ...catalogMetadata,
    catalog_kind: 'plan_benefit',
    entitlement_key: spec.key,
  }
  const found = await findPlanBenefit(spec.key)
  if (!found) {
    logChange(`Create benefit: ${spec.description}`)
    if (dryRun) return `<create:${spec.key}>`
    return (await polar.benefits.create({
      type: 'custom',
      description: spec.description,
      visibility: 'public',
      properties: { note: spec.note },
      metadata,
    })).id
  }
  if (found.type !== 'custom') throw new Error(`Existing ${spec.key} benefit is incompatible`)
  if (
    found.description !== spec.description ||
    found.visibility !== 'public' ||
    found.properties.note !== spec.note ||
    found.metadata.catalog_version !== catalogMetadata.catalog_version
  ) {
    logChange(`Update benefit: ${spec.description}`)
    if (!dryRun) {
      await polar.benefits.update({
        id: found.id,
        requestBody: {
          type: 'custom',
          description: spec.description,
          visibility: 'public',
          properties: { note: spec.note },
          metadata,
        },
      })
    }
  }
  return found.id
}

async function findProduct(plan: 'free' | 'pro', billingCycle: BillingCycle) {
  const all = await items<Product>(await polar.products.list({
    metadata: { app: 'loora', plan },
    limit: 100,
  }))
  return assertSingle(all.filter((product) =>
    product.metadata.app === 'loora' &&
    product.metadata.plan === plan &&
    product.recurringInterval === billingCycle
  ), `${plan} ${billingCycle} product`)
}

function expectedMetadata(spec: ProductSpec) {
  return {
    ...catalogMetadata,
    plan: spec.plan,
    billing_cycle: spec.billingCycle,
  }
}

function fixedPriceAmount(product: Product) {
  const price = product.prices.find((price) =>
    price.amountType === 'fixed' &&
    !price.isArchived &&
    !('meterId' in price)
  )
  return price && 'priceAmount' in price ? price.priceAmount : null
}

async function ensureProduct(spec: ProductSpec) {
  const found = await findProduct(spec.plan, spec.billingCycle)
  const metadata = expectedMetadata(spec)
  if (!found) {
    logChange(`Create ${spec.name}`)
    if (dryRun) return `<create:${spec.plan}_${spec.billingCycle}>`
    const product = await polar.products.create({
      name: spec.name,
      description: spec.description,
      visibility: 'private',
      recurringInterval: spec.billingCycle,
      recurringIntervalCount: 1,
      trialInterval: null,
      trialIntervalCount: null,
      prices: [{
        amountType: 'fixed',
        priceCurrency: 'usd',
        priceAmount: spec.amount,
      }],
      metadata,
    })
    await polar.products.updateBenefits({
      id: product.id,
      productBenefitsUpdate: { benefits: spec.benefitIds },
    })
    return product.id
  }

  const priceMatches = found.prices.length === 1 && fixedPriceAmount(found) === spec.amount
  const detailsMatch =
    found.name === spec.name &&
    found.description === spec.description &&
    found.visibility === 'private' &&
    !found.isArchived &&
    found.trialInterval === null &&
    found.trialIntervalCount === null &&
    found.metadata.app === metadata.app &&
    found.metadata.plan === metadata.plan &&
    found.metadata.billing_cycle === metadata.billing_cycle &&
    found.metadata.catalog_version === metadata.catalog_version

  if (!detailsMatch || !priceMatches) {
    logChange(`Update ${spec.name}`)
    if (!dryRun) {
      await polar.products.update({
        id: found.id,
        productUpdate: {
          name: spec.name,
          description: spec.description,
          visibility: 'private',
          isArchived: false,
          trialInterval: null,
          trialIntervalCount: null,
          metadata,
          ...(!priceMatches
            ? {
                prices: [{
                  amountType: 'fixed' as const,
                  priceCurrency: 'usd' as const,
                  priceAmount: spec.amount,
                }],
              }
            : {}),
        },
      })
    }
  }

  const actualBenefits = found.benefits.map((benefit) => benefit.id)
  if (!sameIds(actualBenefits, spec.benefitIds)) {
    logChange(`Replace ${spec.name} benefits`)
    if (!dryRun) {
      await polar.products.updateBenefits({
        id: found.id,
        productBenefitsUpdate: { benefits: spec.benefitIds },
      })
    }
  }
  return found.id
}

async function archiveLegacyProducts(proBenefitIds: string[]) {
  const all = await items<Product>(await polar.products.list({ limit: 100 }))
  const studios = all.filter((product) =>
    product.metadata.app === 'loora' &&
    product.metadata.plan === 'studio'
  )
  if (studios.length > 1) throw new Error('Multiple legacy Studio products found')
  const studio = studios[0] ?? null
  if (studio && (
    !studio.isArchived ||
    !sameIds(studio.benefits.map((benefit) => benefit.id), proBenefitIds)
  )) {
    logChange('Archive Loora Studio and grant the current Pro benefits to existing subscribers')
    if (!dryRun) {
      await polar.products.update({
        id: studio.id,
        productUpdate: { isArchived: true },
      })
      await polar.products.updateBenefits({
        id: studio.id,
        productBenefitsUpdate: { benefits: proBenefitIds },
      })
    }
  }

  const topUps = all.filter((product) =>
    product.metadata.app === 'loora' &&
    product.metadata.catalog_kind === 'credit_top_up_product' &&
    !product.isArchived
  )
  for (const product of topUps) {
    logChange(`Archive obsolete AI top-up product: ${product.name}`)
    if (!dryRun) {
      await polar.products.update({
        id: product.id,
        productUpdate: { isArchived: true },
      })
    }
  }
  return studio?.id ?? null
}

function isLooraAiCreditBenefit(benefit: Benefit, meterIds: Set<string>) {
  return benefit.type === 'meter_credit' && (
    meterIds.has(benefit.properties.meterId) ||
    benefit.metadata.app === 'loora' ||
    /^loora_.+_credits$/.test(benefit.description)
  )
}

async function removeLegacyAiUsage() {
  const meters = await items(await polar.meters.list({ limit: 100 }))
  const aiMeters = meters.filter((meter) =>
    meter.name === 'loora_ai_credits' ||
    (meter.metadata.app === 'loora' && meter.metadata.catalog_kind === 'ai_credits_meter')
  )
  const meterIds = new Set(aiMeters.map((meter) => meter.id))
  const benefits = await items<Benefit>(await polar.benefits.list({ limit: 100 }))
  const aiBenefits = benefits.filter((benefit) =>
    !benefit.isDeleted && isLooraAiCreditBenefit(benefit, meterIds)
  )
  const benefitIds = new Set(aiBenefits.map((benefit) => benefit.id))

  if (benefitIds.size > 0) {
    const products = await items<Product>(await polar.products.list({ limit: 100 }))
    for (const product of products) {
      const next = product.benefits
        .map((benefit) => benefit.id)
        .filter((id) => !benefitIds.has(id))
      if (next.length === product.benefits.length) continue
      logChange(`Detach obsolete AI credits from ${product.name}`)
      if (!dryRun) {
        await polar.products.updateBenefits({
          id: product.id,
          productBenefitsUpdate: { benefits: next },
        })
      }
    }
  }

  for (const benefit of aiBenefits) {
    logChange(`Delete obsolete AI credit benefit: ${benefit.description}`)
    if (!dryRun) await polar.benefits.delete({ id: benefit.id })
  }
  for (const meter of aiMeters.filter((item) => !item.archivedAt)) {
    logChange(`Archive obsolete AI usage meter: ${meter.name}`)
    if (!dryRun) {
      await polar.meters.update({
        id: meter.id,
        meterUpdate: { isArchived: true },
      })
    }
  }
}

const mcpMeterId = await ensureMcpMeter()
const accessBenefitId = await ensureAccessBenefit()
const benefitIds = new Map<string, string>()
for (const spec of [...commonBenefits, ...freeBenefits, ...proBenefits]) {
  benefitIds.set(spec.key, await ensurePlanBenefit(spec))
}
const ids = (specs: BenefitSpec[]) => specs.map((spec) => benefitIds.get(spec.key)!)
const commonBenefitIds = ids(commonBenefits)
const freeBenefitIds = [accessBenefitId, ...commonBenefitIds, ...ids(freeBenefits)]
const proBenefitIds = [accessBenefitId, ...commonBenefitIds, ...ids(proBenefits)]

const freeProductId = await ensureProduct({
  plan: 'free',
  billingCycle: 'month',
  name: 'Loora Free',
  description: freeDescription,
  amount: 0,
  benefitIds: freeBenefitIds,
})
const proProductId = await ensureProduct({
  plan: 'pro',
  billingCycle: 'month',
  name: 'Loora Pro — Monthly',
  description: proDescription,
  amount: 2000,
  benefitIds: proBenefitIds,
})
const proYearlyProductId = await ensureProduct({
  plan: 'pro',
  billingCycle: 'year',
  name: 'Loora Pro — Yearly',
  description: proDescription,
  amount: 20000,
  benefitIds: proBenefitIds,
})
const studioProductId = await archiveLegacyProducts(proBenefitIds)
await removeLegacyAiUsage()

console.log(JSON.stringify({
  POLAR_ACCESS_BENEFIT_ID: accessBenefitId,
  POLAR_MCP_METER_ID: mcpMeterId,
  POLAR_FREE_PRODUCT_ID: freeProductId,
  POLAR_PRO_PRODUCT_ID: proProductId,
  POLAR_PRO_YEARLY_PRODUCT_ID: proYearlyProductId,
  ...(studioProductId ? { POLAR_STUDIO_PRODUCT_ID: studioProductId } : {}),
}))
