import { flags } from 'railway'

let initPromise: Promise<void> | null = null

function ensureInit() {
  if (initPromise) return initPromise
  if (!process.env.RAILWAY_TOKEN) return Promise.resolve()
  initPromise = flags
    .init({
      refresh: false,
      timeoutMs: 2000,
    })
    .catch(() => undefined)
  return initPromise
}

export type FeatureFlagUser = {
  id: string
  isAdmin?: boolean | null
}

export async function isPublishSitesEnabled(user: FeatureFlagUser) {
  if (user.isAdmin) return true
  if (!process.env.RAILWAY_TOKEN) return false
  await ensureInit()
  return flags.getBoolean('publish-sites', { key: user.id, is_admin: false }, false)
}

/** The agent chat is open to every account. */
export async function isInAppAgentEnabled(_user: FeatureFlagUser) {
  return true
}
