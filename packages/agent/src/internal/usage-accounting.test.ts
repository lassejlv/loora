import { describe, expect, it, mock } from 'bun:test'
import { createGenerationUsageAccounting } from './usage-accounting'

function harness({
  usingChatGPT = false,
  subscriberFunded = false,
  generationLease = null,
}: {
  usingChatGPT?: boolean
  subscriberFunded?: boolean
  generationLease?: string | null
} = {}) {
  const recordManagedUsage = mock(async () => {})
  const recordSubscriberUsage = mock(async () => {})
  const releaseGenerationLease = mock(async () => {})
  const logError = mock(() => {})
  const accounting = createGenerationUsageAccounting({
    usingChatGPT,
    subscriberFunded,
    userId: 'user-one',
    model: 'mini',
    includedCreditsAvailable: 100,
    generationLease,
    recordManagedUsage,
    recordSubscriberUsage,
    releaseGenerationLease,
    logError,
  })
  return {
    accounting,
    recordManagedUsage,
    recordSubscriberUsage,
    releaseGenerationLease,
    logError,
  }
}

describe('generation usage accounting', () => {
  it('combines parent and parallel worker usage for managed providers', async () => {
    const { accounting, recordManagedUsage } = harness()
    accounting.addSubagentUsage({ inputTokens: 11, outputTokens: 13 })
    accounting.addSubagentUsage({ inputTokens: 11, outputTokens: 13 })

    await accounting.onFinish({
      totalUsage: { inputTokens: 100, outputTokens: 200 },
    })

    expect(recordManagedUsage).toHaveBeenCalledWith('user-one', 'mini', 122, 226)
  })

  it('records subscriber usage and releases the lease on finish', async () => {
    const { accounting, recordSubscriberUsage, releaseGenerationLease } = harness({
      subscriberFunded: true,
      generationLease: 'lease-one',
    })

    await accounting.onFinish({
      totalUsage: { inputTokens: 100, outputTokens: 200 },
    })

    expect(recordSubscriberUsage).toHaveBeenCalledWith(
      'user-one',
      'mini',
      100,
      200,
      100,
    )
    expect(releaseGenerationLease).toHaveBeenCalledWith('user-one', 'lease-one')
  })

  it('releases the lease when the provider stream errors', () => {
    const { accounting, releaseGenerationLease, logError } = harness({
      generationLease: 'lease-one',
    })
    const error = new Error('provider failed')

    accounting.onError({ error })

    expect(logError).toHaveBeenCalledWith('[chat] stream error:', error)
    expect(releaseGenerationLease).toHaveBeenCalledWith('user-one', 'lease-one')
  })

  it('keeps ChatGPT generations unmetered by Loora', async () => {
    const { accounting, recordManagedUsage, recordSubscriberUsage } = harness({
      usingChatGPT: true,
    })
    accounting.addSubagentUsage({ inputTokens: 50, outputTokens: 60 })

    await accounting.onFinish({
      totalUsage: { inputTokens: 100, outputTokens: 200 },
    })

    expect(recordManagedUsage).not.toHaveBeenCalled()
    expect(recordSubscriberUsage).not.toHaveBeenCalled()
  })
})
