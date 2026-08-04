import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'

/**
 * Kept in one place because two things read it: the run itself, and the status
 * the editor shows before anybody has typed anything.
 */
export const DEFAULT_ASSISTANT_MODEL = 'gpt-5.6-terra'

export function assistantModelId() {
  return process.env.LOORA_ASSISTANT_MODEL?.trim() || DEFAULT_ASSISTANT_MODEL
}

export interface AssistantProviderCredentials {
  /** The bearer credential: an exchanged inference key, or the OAuth token. */
  apiKey: string
  /** Overrides the OpenAI base URL. */
  baseUrl?: string | null
  /** Sent when a plan-backed endpoint needs to know which account to bill. */
  chatgptAccountId?: string | null
}

/**
 * A model bound to one person's ChatGPT connection. Never a process-wide
 * provider: the credential belongs to the signed-in user, so the instance is
 * built per run and thrown away with it.
 */
export function assistantModel(
  credentials: AssistantProviderCredentials,
  modelId = assistantModelId(),
): LanguageModel {
  const provider = createOpenAI({
    apiKey: credentials.apiKey,
    baseURL: credentials.baseUrl ?? undefined,
    headers: credentials.chatgptAccountId
      ? { 'chatgpt-account-id': credentials.chatgptAccountId }
      : undefined,
  })
  // Responses is the default. `chat` exists for a base URL that speaks only
  // Chat Completions — some plan-backed endpoints do.
  return process.env.LOORA_ASSISTANT_API?.trim() === 'chat'
    ? provider.chat(modelId)
    : provider.responses(modelId)
}
