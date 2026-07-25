export type ProviderDefinition =
  | {
      kind: 'neon'
      label: string
      requiredEnv: readonly string[]
    }
  | {
      kind: 'chatgpt'
      label: string
    }
  | {
      kind: 'openrouter'
      label: string
    }

// Provider credentials are read from server-only environment variables and never reach the client.
export const PROVIDERS = {
  loora: {
    kind: 'neon',
    label: 'Loora',
    requiredEnv: ['NEON_AI_GATEWAY_BASE_URL', 'NEON_AI_GATEWAY_TOKEN'],
  },
  chatgpt: {
    kind: 'chatgpt',
    label: 'ChatGPT',
  },
  openrouter: {
    kind: 'openrouter',
    label: 'OpenRouter',
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
    contextOver200k?: {
      input: number
      output: number
    }
  }
}

// `id` is Loora's stable key. `modelId` is the exact id sent to the provider.
// Prices are USD per 1M tokens and power the existing usage limits.
export const MODELS = [
  {
    id: 'gemini-3-5-flash',
    label: 'Gemini 3.5 Flash',
    provider: 'loora',
    modelId: 'gemini-3-5-flash',
    supportsImageInput: true,
    price: { input: 1.5, output: 9 },
  },
  {
    id: 'gemini-3-1-pro',
    label: 'Gemini 3.1 Pro',
    provider: 'loora',
    modelId: 'gemini-3-1-pro',
    supportsImageInput: true,
    price: {
      input: 2,
      output: 12,
      contextOver200k: { input: 4, output: 18 },
    },
  },
  {
    id: 'gemini-3-1-flash-lite',
    label: 'Gemini 3.1 Flash Lite',
    provider: 'loora',
    modelId: 'gemini-3-1-flash-lite',
    supportsImageInput: true,
    price: { input: 0.25, output: 1.5 },
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
  {
    id: 'openrouter-auto',
    label: 'OpenRouter Auto',
    provider: 'openrouter',
    modelId: 'openrouter/auto',
    // Auto routing does not guarantee that the selected upstream model accepts images.
    supportsImageInput: false,
    // Requests use the user's OpenRouter balance, not Loora credits.
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
