import type { ModelKey } from '../models'

type TokenUsage = {
  inputTokens?: number
  outputTokens?: number
}

export function createGenerationUsageAccounting({
  usingChatGPT,
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
  usingChatGPT: boolean
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
  let subagentInputTokens = 0
  let subagentOutputTokens = 0

  return {
    addSubagentUsage(usage: TokenUsage) {
      subagentInputTokens += usage.inputTokens ?? 0
      subagentOutputTokens += usage.outputTokens ?? 0
    },
    onError({ error }: { error: unknown }) {
      logError('[chat] stream error:', error)
      if (generationLease) {
        void releaseGenerationLease(userId, generationLease)
      }
    },
    async onFinish({ totalUsage }: { totalUsage: TokenUsage }) {
      if (usingChatGPT) return
      try {
        const inputTokens = (totalUsage.inputTokens ?? 0) + subagentInputTokens
        const outputTokens = (totalUsage.outputTokens ?? 0) + subagentOutputTokens
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
