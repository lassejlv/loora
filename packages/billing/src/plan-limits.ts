import type { BillingPlan } from './billing-policy'

/** Effective plan used when applying product capacity limits. */
export type LimitsPlan = BillingPlan | 'admin' | 'disabled'

export const FREE_DESIGN_FILE_LIMIT = 50
/** Open = `active` or `proposed` (not applied/closed). */
export const FREE_OPEN_BRANCHES_PER_DESIGN = 1

export interface PlanCapacity {
  /** Max owned design files; `null` means unlimited. */
  designFiles: number | null
  /** Max open branches per design; `null` means unlimited. */
  openBranchesPerDesign: number | null
}

export const UNLIMITED_CAPACITY: PlanCapacity = {
  designFiles: null,
  openBranchesPerDesign: null,
}

export const FREE_CAPACITY: PlanCapacity = {
  designFiles: FREE_DESIGN_FILE_LIMIT,
  openBranchesPerDesign: FREE_OPEN_BRANCHES_PER_DESIGN,
}

export function planCapacity(plan: LimitsPlan | null | undefined): PlanCapacity {
  if (plan === 'admin' || plan === 'disabled' || plan === 'pro' || plan === 'studio') {
    return UNLIMITED_CAPACITY
  }
  return FREE_CAPACITY
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

export function designFileLimitMessage(limit: number) {
  return `Free plan includes up to ${limit.toLocaleString()} design files. Upgrade to Pro for unlimited files.`
}

export function openBranchLimitMessage(limit: number) {
  const noun = limit === 1 ? 'open branch' : 'open branches'
  return `Free plan includes ${limit.toLocaleString()} ${noun} per design. Close or apply it, or upgrade to Pro for unlimited branches.`
}

export class PlanLimitError extends Error {
  constructor(
    readonly code: 'DESIGN_FILE_LIMIT' | 'OPEN_BRANCH_LIMIT',
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
