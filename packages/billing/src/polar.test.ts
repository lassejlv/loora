import { describe, expect, test } from 'vitest'
import { isPolarBillingRequired, resolvePolarConfig } from './polar'

const complete = {
  REQUIRE_POLAR_BILLING: 'true',
  POLAR_SERVER: 'production',
  POLAR_ACCESS_TOKEN: 'token',
  POLAR_WEBHOOK_SECRET: 'secret',
  POLAR_FREE_PRODUCT_ID: 'free',
  POLAR_PRO_PRODUCT_ID: 'pro',
  POLAR_PRO_YEARLY_PRODUCT_ID: 'pro-yearly',
  POLAR_STUDIO_PRODUCT_ID: 'studio',
  POLAR_MCP_METER_ID: 'mcp-meter',
  POLAR_ACCESS_BENEFIT_ID: 'access',
  BETTER_AUTH_URL: 'https://loora.example/path',
}

describe('Polar configuration', () => {
  test('billing is required by default and only explicit false disables it', () => {
    expect(isPolarBillingRequired(null)).toBe(true)
    expect(isPolarBillingRequired(' true ')).toBe(true)
    expect(isPolarBillingRequired(' FALSE ')).toBe(false)
  })

  test('missing configuration is fatal when billing is required', () => {
    expect(() => resolvePolarConfig({})).toThrow('Missing required Polar configuration')
  })

  test('disabled billing allows missing Polar configuration', () => {
    expect(resolvePolarConfig({ REQUIRE_POLAR_BILLING: 'false' })).toEqual({
      required: false,
      config: null,
    })
  })

  test('validates and normalizes the configured origin', () => {
    expect(resolvePolarConfig(complete)).toEqual({
      required: true,
      config: {
        server: 'production',
        accessToken: 'token',
        webhookSecret: 'secret',
        freeProductId: 'free',
        proProductId: 'pro',
        proYearlyProductId: 'pro-yearly',
        studioProductId: 'studio',
        mcpMeterId: 'mcp-meter',
        agentMeterId: null,
        accessBenefitId: 'access',
        origin: 'https://loora.example',
      },
    })
  })

  test('returns to the app when auth is served from a separate origin', () => {
    expect(resolvePolarConfig({
      ...complete,
      APP_ORIGIN: 'https://loora.design/app',
      BETTER_AUTH_URL: 'https://api.loora.design',
    }).config?.origin).toBe('https://loora.design')
  })

  test('keeps the legacy Studio product optional', () => {
    expect(resolvePolarConfig({
      ...complete,
      POLAR_STUDIO_PRODUCT_ID: undefined,
    }).config?.studioProductId).toBeNull()
  })
})
