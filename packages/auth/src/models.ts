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
      kind: 'chatgpt'
      label: string
    }

// Add any OpenAI-compatible provider here. API keys are read from the named
// environment variable on the server and are never included in this config.
export const PROVIDERS = {
  loora: {
    kind: 'openai-compatible',
    label: 'Loora',
    baseURL: 'AI_GATEWAY_URL',
    apiKeyEnv: 'AI_KEY',
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
  {
    id: 'loora-mini',
    label: 'Loora Mini',
    provider: 'loora',
    modelId: 'gemini-3-5-flash',
    supportsImageInput: true,
    price: { input: 1.2, output: 4.9 },
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
