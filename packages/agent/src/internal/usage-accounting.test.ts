import { describe, expect, it, mock } from 'bun:test'
import { createGenerationUsageAccounting } from './usage-accounting'

function harness({
  unmetered = false,
  subscriberFunded = false,
  generationLease = null,
}: {
  unmetered?: boolean
  subscriberFunded?: boolean
  generationLease?: string | null
} = {}) {
  const recordManagedUsage = mock(async () => {})
  const recordSubscriberUsage = mock(async () => {})
  const releaseGenerationLease = mock(async () => {})
  const logError = mock(() => {})
  const accounting = createGenerationUsageAccounting({
    unmetered,
    subscriberFunded,
    userId: 'user-one',
    model: 'gemini-3-5-flash',
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
  it('records managed usage from the generation totals', async () => {
    const { accounting, recordManagedUsage } = harness()

    await accounting.onFinish({
      totalUsage: { inputTokens: 100, outputTokens: 200 },
    })

    expect(recordManagedUsage).toHaveBeenCalledWith('user-one', 'gemini-3-5-flash', 100, 200)
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
      'gemini-3-5-flash',
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

  it('keeps user-funded provider generations unmetered by Loora', async () => {
    const { accounting, recordManagedUsage, recordSubscriberUsage } = harness({
      unmetered: true,
    })

    await accounting.onFinish({
      totalUsage: { inputTokens: 100, outputTokens: 200 },
    })

    expect(recordManagedUsage).not.toHaveBeenCalled()
    expect(recordSubscriberUsage).not.toHaveBeenCalled()
  })
})
