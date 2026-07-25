import type { ModelKey } from '../models'

type TokenUsage = {
  inputTokens?: number
  outputTokens?: number
}

export function createGenerationUsageAccounting({
  unmetered,
  subscriberFunded,
  userId,
  model,
  includedCreditsAvailable,
  generationLease,
  recordManagedUsage,
  recordSubscriberUsage,
  releaseGenerationLease,
  logError = console.error,
}: {
  unmetered: boolean
  subscriberFunded: boolean
  userId: string
  model: ModelKey
  includedCreditsAvailable: number
  generationLease: string | null
  recordManagedUsage: (
    userId: string,
    model: ModelKey,
    inputTokens: number,
    outputTokens: number,
  ) => Promise<unknown>
  recordSubscriberUsage: (
    userId: string,
    model: ModelKey,
    inputTokens: number,
    outputTokens: number,
    includedCreditsAvailable: number,
  ) => Promise<unknown>
  releaseGenerationLease: (userId: string, token: string) => Promise<unknown>
  logError?: (...args: unknown[]) => void
}) {
  return {
    onError({ error }: { error: unknown }) {
      logError('[chat] stream error:', error)
      if (generationLease) {
        void releaseGenerationLease(userId, generationLease)
      }
    },
    async onFinish({ totalUsage }: { totalUsage: TokenUsage }) {
      if (unmetered) return
      try {
        const inputTokens = totalUsage.inputTokens ?? 0
        const outputTokens = totalUsage.outputTokens ?? 0
        if (subscriberFunded) {
          await recordSubscriberUsage(
            userId,
            model,
            inputTokens,
            outputTokens,
            includedCreditsAvailable,
          )
        } else {
          await recordManagedUsage(userId, model, inputTokens, outputTokens)
        }
      } catch (error) {
        logError('[chat] Failed to record usage:', error)
      } finally {
        if (generationLease) {
          await releaseGenerationLease(userId, generationLease)
        }
      }
    },
  }
}
