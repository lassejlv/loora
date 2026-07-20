import { describe, expect, test } from 'bun:test'
import { isPolarBillingRequired, resolvePolarConfig } from './polar'

const complete = {
  REQUIRE_POLAR_BILLING: 'true',
  POLAR_SERVER: 'production',
  POLAR_ACCESS_TOKEN: 'token',
  POLAR_WEBHOOK_SECRET: 'secret',
  POLAR_PRO_PRODUCT_ID: 'pro',
  POLAR_STUDIO_PRODUCT_ID: 'studio',
  POLAR_ACCESS_BENEFIT_ID: 'access',
  POLAR_AI_METER_ID: 'meter',
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
        proProductId: 'pro',
        studioProductId: 'studio',
        accessBenefitId: 'access',
        aiMeterId: 'meter',
        origin: 'https://loora.example',
      },
    })
  })
})
