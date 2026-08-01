import type { BillingPlan } from './billing-policy'

/** Effective plan used when applying product capacity limits. */
export type LimitsPlan = BillingPlan | 'admin' | 'disabled'

export const FREE_DESIGN_FILE_LIMIT = 50
/** Open = `active` or `proposed` (not applied/closed). */
export const FREE_OPEN_BRANCHES_PER_DESIGN = 1

const GIB = 1024 ** 3
export const FREE_STORAGE_BYTES = 1 * GIB
export const PRO_STORAGE_BYTES = 50 * GIB

export const FREE_HISTORY_RETENTION_DAYS = 2
export const PRO_HISTORY_RETENTION_DAYS = 90
const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface PlanCapacity {
  /** Max owned design files; `null` means unlimited. */
  designFiles: number | null
  /** Max open branches per design; `null` means unlimited. */
  openBranchesPerDesign: number | null
  /** Max total asset bytes; `null` means unlimited. */
  storageBytes: number | null
  /**
   * Rolling version-history window in days; `null` means unlimited retention
   * (admin / billing-disabled).
   */
  historyRetentionDays: number | null
}

export const UNLIMITED_CAPACITY: PlanCapacity = {
  designFiles: null,
  openBranchesPerDesign: null,
  storageBytes: null,
  historyRetentionDays: null,
}

export const FREE_CAPACITY: PlanCapacity = {
  designFiles: FREE_DESIGN_FILE_LIMIT,
  openBranchesPerDesign: FREE_OPEN_BRANCHES_PER_DESIGN,
  storageBytes: FREE_STORAGE_BYTES,
  historyRetentionDays: FREE_HISTORY_RETENTION_DAYS,
}

export const PRO_CAPACITY: PlanCapacity = {
  designFiles: null,
  openBranchesPerDesign: null,
  storageBytes: PRO_STORAGE_BYTES,
  historyRetentionDays: PRO_HISTORY_RETENTION_DAYS,
}

export function planCapacity(plan: LimitsPlan | null | undefined): PlanCapacity {
  if (plan === 'admin' || plan === 'disabled') return UNLIMITED_CAPACITY
  if (plan === 'pro' || plan === 'studio') return PRO_CAPACITY
  return FREE_CAPACITY
}

/**
 * Hard-delete retention is only safe for an explicit Free/Pro/Studio plan.
 * Fail-closed Free (unknown/missing entitlement) must never prune — that can
 * permanently destroy a Pro user's 90-day history.
 */
export function canHardPruneHistory(plan: LimitsPlan | null | undefined) {
  return plan === 'free' || plan === 'pro' || plan === 'studio'
}

/** Map authorizeBilling / billing status into a limits plan. */
export function limitsPlanFromBilling(input: {
  source: 'admin' | 'disabled' | 'cache' | 'polar'
  plan?: BillingPlan | null
  entitlementPlan?: string | null
}): LimitsPlan {
  if (input.source === 'admin' || input.source === 'disabled') return input.source
  const plan = input.plan ?? input.entitlementPlan
  if (plan === 'free' || plan === 'pro' || plan === 'studio') return plan
  // Access without a recognized plan: apply Free caps, not unlimited.
  return 'free'
}

export function wouldExceedLimit(limit: number | null, used: number) {
  return limit !== null && used >= limit
}

/** Storage checks include the bytes about to be uploaded. */
export function wouldExceedStorage(
  limit: number | null,
  usedBytes: number,
  incomingBytes: number,
) {
  if (limit === null) return false
  return usedBytes + Math.max(0, incomingBytes) > limit
}

/** Earliest `createdAt` still visible for a retention window. */
export function historyCutoff(
  retentionDays: number | null | undefined,
  now = new Date(),
): Date | null {
  if (retentionDays === null || retentionDays === undefined) return null
  const days = Math.max(0, Math.floor(retentionDays))
  return new Date(now.getTime() - days * MS_PER_DAY)
}

export function isWithinHistoryRetention(
  createdAt: Date,
  retentionDays: number | null | undefined,
  now = new Date(),
) {
  const cutoff = historyCutoff(retentionDays, now)
  if (!cutoff) return true
  return createdAt.getTime() >= cutoff.getTime()
}

export function formatStorageBytes(bytes: number) {
  if (bytes >= GIB) {
    const gib = bytes / GIB
    const rounded = gib >= 10 ? Math.round(gib) : Math.round(gib * 10) / 10
    return `${rounded} GB`
  }
  if (bytes >= 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`
  }
  if (bytes >= 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
  }
  return `${Math.max(0, Math.floor(bytes))} B`
}

export function designFileLimitMessage(limit: number) {
  return `Free plan includes up to ${limit.toLocaleString()} design files. Upgrade to Pro for unlimited files.`
}

export function openBranchLimitMessage(limit: number) {
  const noun = limit === 1 ? 'open branch' : 'open branches'
  return `Free plan includes ${limit.toLocaleString()} ${noun} per design. Close or apply it, or upgrade to Pro for unlimited branches.`
}

export function storageLimitMessage(
  plan: LimitsPlan | null | undefined,
  limit: number,
  usedBytes: number,
  incomingBytes: number,
) {
  const label = plan === 'pro' || plan === 'studio' ? 'Pro' : 'Free'
  const upgrade = plan === 'free' || plan === null || plan === undefined
    ? ' Upgrade to Pro for 50 GB.'
    : ''
  return (
    `${label} plan includes ${formatStorageBytes(limit)} of asset storage ` +
    `(${formatStorageBytes(usedBytes)} used). ` +
    `This upload needs ${formatStorageBytes(incomingBytes)}.${upgrade}`
  )
}

export function historyRetentionMessage(
  plan: LimitsPlan | null | undefined,
  days: number,
) {
  const label = plan === 'pro' || plan === 'studio' ? 'Pro' : 'Free'
  const upgrade = plan === 'free' || plan === null || plan === undefined
    ? ' Upgrade to Pro for 90 days of history.'
    : ''
  const unit = days === 1 ? 'day' : 'days'
  return (
    `${label} plan keeps version history for ${days.toLocaleString()} ${unit}. ` +
    `This version is outside that window.${upgrade}`
  )
}

export class PlanLimitError extends Error {
  constructor(
    readonly code:
      | 'DESIGN_FILE_LIMIT'
      | 'OPEN_BRANCH_LIMIT'
      | 'STORAGE_LIMIT'
      | 'HISTORY_RETENTION',
    readonly limit: number,
    message: string,
  ) {
    super(message)
    this.name = 'PlanLimitError'
  }
}

export function assertDesignFileCapacity(capacity: PlanCapacity, used: number) {
  if (wouldExceedLimit(capacity.designFiles, used)) {
    const limit = capacity.designFiles!
    throw new PlanLimitError(
      'DESIGN_FILE_LIMIT',
      limit,
      designFileLimitMessage(limit),
    )
  }
}

export function assertOpenBranchCapacity(capacity: PlanCapacity, openCount: number) {
  if (wouldExceedLimit(capacity.openBranchesPerDesign, openCount)) {
    const limit = capacity.openBranchesPerDesign!
    throw new PlanLimitError(
      'OPEN_BRANCH_LIMIT',
      limit,
      openBranchLimitMessage(limit),
    )
  }
}

export function assertStorageCapacity(
  capacity: PlanCapacity,
  usedBytes: number,
  incomingBytes: number,
  plan?: LimitsPlan | null,
) {
  if (wouldExceedStorage(capacity.storageBytes, usedBytes, incomingBytes)) {
    const limit = capacity.storageBytes!
    throw new PlanLimitError(
      'STORAGE_LIMIT',
      limit,
      storageLimitMessage(plan, limit, usedBytes, incomingBytes),
    )
  }
}

export function assertHistoryVersionAccessible(
  capacity: PlanCapacity,
  createdAt: Date,
  plan?: LimitsPlan | null,
  now = new Date(),
) {
  if (isWithinHistoryRetention(createdAt, capacity.historyRetentionDays, now)) {
    return
  }
  const days = capacity.historyRetentionDays!
  throw new PlanLimitError(
    'HISTORY_RETENTION',
    days,
    historyRetentionMessage(plan, days),
  )
}
