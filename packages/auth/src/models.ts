export type ProviderDefinition =
  | {
      kind: 'openai-compatible'
      label: string
      baseURL: string
      apiKeyEnv: string
      includeUsage?: boolean
      headers?: Record<string, string>
    }
  | {
      // Neon AI Gateway via @neondatabase/ai-sdk-provider: routes each model
      // to the right gateway dialect (Anthropic → Messages, OpenAI →
      // Responses, Gemini/others → chat completions) with the schema
      // conversions each native API needs — a plain openai-compatible client
      // 400s on Gemini because Google rejects JSON-Schema meta keys.
      kind: 'neon'
      label: string
      baseUrlEnv: string
      apiKeyEnv: string
    }
  | {
      kind: 'chatgpt'
      label: string
    }

// Add any OpenAI-compatible provider here. API keys are read from the named
// environment variable on the server and are never included in this config.
export const PROVIDERS = {
  loora: {
    kind: 'neon',
    label: 'Loora',
    baseUrlEnv: 'NEON_AI_GATEWAY_BASE_URL',
    apiKeyEnv: 'NEON_AI_GATEWAY_TOKEN',
  },
  chatgpt: {
    kind: 'chatgpt',
    label: 'ChatGPT',
  },
} as const satisfies Record<string, ProviderDefinition>

export type ProviderKey = keyof typeof PROVIDERS

export const CHATGPT_REASONING_EFFORTS = [
  { id: 'low', label: 'Light' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Xhigh' },
  { id: 'max', label: 'Max' },
] as const

export type ChatGPTReasoningEffort = (typeof CHATGPT_REASONING_EFFORTS)[number]['id']

export const DEFAULT_CHATGPT_REASONING_EFFORT: ChatGPTReasoningEffort = 'medium'

export function getChatGPTReasoningEffort(value: unknown): ChatGPTReasoningEffort {
  return CHATGPT_REASONING_EFFORTS.find((effort) => effort.id === value)?.id
    ?? DEFAULT_CHATGPT_REASONING_EFFORT
}

export interface ModelDefinition {
  id: string
  label: string
  provider: ProviderKey
  modelId: string
  supportsImageInput: boolean
  price: {
    input: number
    output: number
  }
}

// `id` is Loora's stable key. `modelId` is the exact id sent to the provider.
// Prices are USD per 1M tokens and power the existing usage limits.
export const MODELS = [
  // Claude models ride the gateway's NATIVE Anthropic Messages route.
  // Gemini has to go through the OpenAI-compatible translation (the native
  // Gemini endpoint rejects streaming), which currently loses Gemini 3
  // thought signatures and tool-result images on multi-turn replay — every
  // follow-up 400s. Revisit Gemini when the gateway fixes that translation.
  {
    id: 'loora-mini',
    label: 'Loora Mini',
    provider: 'loora',
    modelId: 'claude-haiku-4-5',
    supportsImageInput: true,
    price: { input: 1, output: 5 },
  },
  {
    id: 'loora-max',
    label: 'Loora Max',
    provider: 'loora',
    modelId: 'claude-sonnet-4-6',
    supportsImageInput: true,
    price: { input: 3, output: 15 },
  },
  {
    id: 'gpt-5.6-sol',
    label: 'GPT-5.6 Sol',
    provider: 'chatgpt',
    modelId: 'gpt-5.6-sol',
    supportsImageInput: true,
    // Requests use the signed-in user's ChatGPT plan, not Loora's provider bill.
    price: { input: 0, output: 0 },
  },
  {
    id: 'gpt-5.6-terra',
    label: 'GPT-5.6 Terra',
    provider: 'chatgpt',
    modelId: 'gpt-5.6-terra',
    supportsImageInput: true,
    price: { input: 0, output: 0 },
  },
  {
    id: 'gpt-5.6-luna',
    label: 'GPT-5.6 Luna',
    provider: 'chatgpt',
    modelId: 'gpt-5.6-luna',
    supportsImageInput: true,
    price: { input: 0, output: 0 },
  },
] as const satisfies readonly ModelDefinition[]

export type ModelKey = (typeof MODELS)[number]['id']

// The first model is the default shown to new users.
export const DEFAULT_MODEL: ModelKey = MODELS[0].id

export function getModel(model: string) {
  return MODELS.find((candidate) => candidate.id === model) ?? MODELS[0]
}

export function getProvider(provider: ProviderKey): ProviderDefinition {
  return PROVIDERS[provider]
}
