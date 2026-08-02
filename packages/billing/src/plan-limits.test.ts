import { describe, expect, test } from 'vitest'
import {
  FREE_CAPACITY,
  FREE_DESIGN_FILE_LIMIT,
  FREE_HISTORY_RETENTION_DAYS,
  FREE_OPEN_BRANCHES_PER_DESIGN,
  FREE_STORAGE_BYTES,
  PRO_CAPACITY,
  PRO_HISTORY_RETENTION_DAYS,
  PRO_STORAGE_BYTES,
  PlanLimitError,
  UNLIMITED_CAPACITY,
  assertDesignFileCapacity,
  assertHistoryVersionAccessible,
  assertOpenBranchCapacity,
  assertStorageCapacity,
  canHardPruneHistory,
  formatStorageBytes,
  historyCutoff,
  isWithinHistoryRetention,
  limitsPlanFromBilling,
  planCapacity,
  wouldExceedLimit,
  wouldExceedStorage,
} from './plan-limits'

describe('plan limits', () => {
  test('Free and Pro capacity match the published product', () => {
    expect(planCapacity('free')).toEqual(FREE_CAPACITY)
    expect(planCapacity(null)).toEqual(FREE_CAPACITY)
    expect(planCapacity('pro')).toEqual(PRO_CAPACITY)
    expect(planCapacity('studio')).toEqual(PRO_CAPACITY)
    expect(planCapacity('admin')).toEqual(UNLIMITED_CAPACITY)
    expect(planCapacity('disabled')).toEqual(UNLIMITED_CAPACITY)
    expect(FREE_DESIGN_FILE_LIMIT).toBe(50)
    expect(FREE_OPEN_BRANCHES_PER_DESIGN).toBe(1)
    expect(FREE_STORAGE_BYTES).toBe(1024 ** 3)
    expect(PRO_STORAGE_BYTES).toBe(50 * 1024 ** 3)
    expect(FREE_HISTORY_RETENTION_DAYS).toBe(2)
    expect(PRO_HISTORY_RETENTION_DAYS).toBe(90)
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

  test('storage capacity includes the incoming upload size', () => {
    expect(wouldExceedStorage(FREE_STORAGE_BYTES, FREE_STORAGE_BYTES - 10, 9)).toBe(false)
    expect(wouldExceedStorage(FREE_STORAGE_BYTES, FREE_STORAGE_BYTES - 10, 11)).toBe(true)
    expect(wouldExceedStorage(null, PRO_STORAGE_BYTES * 2, 1)).toBe(false)
  })

  test('history retention is a rolling day window', () => {
    const now = new Date('2026-07-30T12:00:00.000Z')
    expect(historyCutoff(2, now)).toEqual(new Date('2026-07-28T12:00:00.000Z'))
    expect(historyCutoff(90, now)).toEqual(new Date('2026-05-01T12:00:00.000Z'))
    expect(historyCutoff(null, now)).toBeNull()

    expect(isWithinHistoryRetention(new Date('2026-07-29T00:00:00.000Z'), 2, now)).toBe(true)
    expect(isWithinHistoryRetention(new Date('2026-07-27T11:59:59.000Z'), 2, now)).toBe(false)
  })

  test('assert helpers throw PlanLimitError at the cap', () => {
    expect(() => assertDesignFileCapacity(FREE_CAPACITY, 49)).not.toThrow()
    expect(() => assertDesignFileCapacity(FREE_CAPACITY, 50)).toThrow(PlanLimitError)
    expect(() => assertOpenBranchCapacity(FREE_CAPACITY, 0)).not.toThrow()
    expect(() => assertOpenBranchCapacity(FREE_CAPACITY, 1)).toThrow(PlanLimitError)
    expect(() => assertDesignFileCapacity(UNLIMITED_CAPACITY, 10_000)).not.toThrow()

    expect(() =>
      assertStorageCapacity(FREE_CAPACITY, FREE_STORAGE_BYTES - 1, 1, 'free'),
    ).not.toThrow()
    expect(() =>
      assertStorageCapacity(FREE_CAPACITY, FREE_STORAGE_BYTES, 1, 'free'),
    ).toThrow(PlanLimitError)
    expect(() =>
      assertStorageCapacity(PRO_CAPACITY, PRO_STORAGE_BYTES - 100, 200, 'pro'),
    ).toThrow(PlanLimitError)
    expect(() =>
      assertStorageCapacity(UNLIMITED_CAPACITY, PRO_STORAGE_BYTES * 2, 1, 'admin'),
    ).not.toThrow()

    const now = new Date('2026-07-30T12:00:00.000Z')
    expect(() =>
      assertHistoryVersionAccessible(
        FREE_CAPACITY,
        new Date('2026-07-29T12:00:00.000Z'),
        'free',
        now,
      ),
    ).not.toThrow()
    expect(() =>
      assertHistoryVersionAccessible(
        FREE_CAPACITY,
        new Date('2026-07-27T12:00:00.000Z'),
        'free',
        now,
      ),
    ).toThrow(PlanLimitError)
    expect(() =>
      assertHistoryVersionAccessible(
        UNLIMITED_CAPACITY,
        new Date('2020-01-01T00:00:00.000Z'),
        'admin',
        now,
      ),
    ).not.toThrow()
  })

  test('formats storage sizes for error messages', () => {
    expect(formatStorageBytes(FREE_STORAGE_BYTES)).toBe('1 GB')
    expect(formatStorageBytes(PRO_STORAGE_BYTES)).toBe('50 GB')
    expect(formatStorageBytes(512 * 1024)).toBe('512 KB')
  })

  test('hard history prune only runs for explicit Free/Pro/Studio plans', () => {
    expect(canHardPruneHistory('free')).toBe(true)
    expect(canHardPruneHistory('pro')).toBe(true)
    expect(canHardPruneHistory('studio')).toBe(true)
    expect(canHardPruneHistory('admin')).toBe(false)
    expect(canHardPruneHistory('disabled')).toBe(false)
    expect(canHardPruneHistory(null)).toBe(false)
  })
})
