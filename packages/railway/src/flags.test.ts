import { describe, expect, it } from 'vitest'
import { isInAppAgentEnabled } from './flags'

describe('isInAppAgentEnabled', () => {
  it('allows admins', async () => {
    await expect(
      isInAppAgentEnabled({ id: 'admin', isAdmin: true }),
    ).resolves.toBe(true)
  })

  it('refuses non-admins regardless of Railway configuration', async () => {
    await expect(
      isInAppAgentEnabled({ id: 'user', isAdmin: false }),
    ).resolves.toBe(false)
    await expect(isInAppAgentEnabled({ id: 'user' })).resolves.toBe(false)
  })
})
