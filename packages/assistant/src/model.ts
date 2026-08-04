import { createChatGPTProxyProvider } from '@opencoredev/loginwithchatgpt-ai'
import type { LanguageModel } from 'ai'

/**
 * Kept in one place because two things read it: the run itself, and the status
 * the editor shows before anybody has typed anything.
 */
export const DEFAULT_ASSISTANT_MODEL = 'gpt-5.6-terra'

export function assistantModelId() {
  return process.env.LOORA_ASSISTANT_MODEL?.trim() || DEFAULT_ASSISTANT_MODEL
}

export function selectAssistantModel(
  models: string[],
  preferred = assistantModelId(),
) {
  return models.includes(preferred) ? preferred : models[0]
}

/**
 * A model bound to the ChatGPT session on the current request. The handler's
 * proxy injects credentials server-side, so bearer tokens never enter this
 * package or application code.
 */
export function assistantModel(
  requestFetch: typeof fetch,
  modelId = assistantModelId(),
): LanguageModel {
  return createChatGPTProxyProvider({ fetch: requestFetch })(modelId)
}
