import { describe, expect, it } from 'vitest'
import { isInAppAgentEnabled } from './flags'

describe('isInAppAgentEnabled', () => {
  it('allows every account', async () => {
    await expect(
      isInAppAgentEnabled({ id: 'admin', isAdmin: true }),
    ).resolves.toBe(true)
    await expect(
      isInAppAgentEnabled({ id: 'user', isAdmin: false }),
    ).resolves.toBe(true)
    await expect(isInAppAgentEnabled({ id: 'user' })).resolves.toBe(true)
  })
})
