import { describe, expect, test } from 'bun:test'
import {
  FREE_CAPACITY,
  FREE_DESIGN_FILE_LIMIT,
  FREE_OPEN_BRANCHES_PER_DESIGN,
  PlanLimitError,
  UNLIMITED_CAPACITY,
  assertDesignFileCapacity,
  assertOpenBranchCapacity,
  limitsPlanFromBilling,
  planCapacity,
  wouldExceedLimit,
} from './plan-limits'

describe('plan limits', () => {
  test('Free is capped; Pro, Studio, admin, and disabled are unlimited', () => {
    expect(planCapacity('free')).toEqual(FREE_CAPACITY)
    expect(planCapacity(null)).toEqual(FREE_CAPACITY)
    expect(planCapacity('pro')).toEqual(UNLIMITED_CAPACITY)
    expect(planCapacity('studio')).toEqual(UNLIMITED_CAPACITY)
    expect(planCapacity('admin')).toEqual(UNLIMITED_CAPACITY)
    expect(planCapacity('disabled')).toEqual(UNLIMITED_CAPACITY)
    expect(FREE_DESIGN_FILE_LIMIT).toBe(50)
    expect(FREE_OPEN_BRANCHES_PER_DESIGN).toBe(1)
  })

  test('maps billing sources to a limits plan', () => {
    expect(limitsPlanFromBilling({ source: 'admin' })).toBe('admin')
    expect(limitsPlanFromBilling({ source: 'disabled' })).toBe('disabled')
    expect(limitsPlanFromBilling({ source: 'cache', plan: 'pro' })).toBe('pro')
    expect(limitsPlanFromBilling({
      source: 'polar',
      entitlementPlan: 'free',
    })).toBe('free')
    expect(limitsPlanFromBilling({ source: 'cache' })).toBe('free')
  })

  test('wouldExceedLimit treats null as unlimited', () => {
    expect(wouldExceedLimit(null, 10_000)).toBe(false)
    expect(wouldExceedLimit(50, 49)).toBe(false)
    expect(wouldExceedLimit(50, 50)).toBe(true)
    expect(wouldExceedLimit(1, 1)).toBe(true)
  })

  test('assert helpers throw PlanLimitError at the cap', () => {
    expect(() => assertDesignFileCapacity(FREE_CAPACITY, 49)).not.toThrow()
    expect(() => assertDesignFileCapacity(FREE_CAPACITY, 50)).toThrow(PlanLimitError)
    expect(() => assertOpenBranchCapacity(FREE_CAPACITY, 0)).not.toThrow()
    expect(() => assertOpenBranchCapacity(FREE_CAPACITY, 1)).toThrow(PlanLimitError)
    expect(() => assertDesignFileCapacity(UNLIMITED_CAPACITY, 10_000)).not.toThrow()
  })
})
