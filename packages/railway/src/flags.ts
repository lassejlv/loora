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

/**
 * The agent chat in the editor. Off unless the flag says otherwise, so an
 * environment with no Railway token — a local checkout, a preview deploy —
 * simply does not show it. Admins always see it, same as publishing.
 */
export async function isInAppAgentEnabled(user: FeatureFlagUser) {
  if (user.isAdmin) return true
  if (!process.env.RAILWAY_TOKEN) return false
  await ensureInit()
  return flags.getBoolean('in-app-agent', { key: user.id, is_admin: false }, false)
}