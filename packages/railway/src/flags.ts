import { evaluateFlag } from './graphql'

export type FeatureFlagUser = {
  id: string
  isAdmin?: boolean | null
}

export async function isPublishSitesEnabled(user: FeatureFlagUser) {
  if (user.isAdmin) return true
  if (!process.env.RAILWAY_TOKEN || !process.env.RAILWAY_PROJECT_ID) return false
  try {
    const result = await evaluateFlag('publish-sites', {
      key: user.id,
      is_admin: false,
    })
    return result.value === true
  } catch {
    return false
  }
}

/** The agent chat is open to every account. */
export async function isInAppAgentEnabled(_user: FeatureFlagUser) {
  return true
}
