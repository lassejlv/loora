export type ProviderDefinition =
  | {
      kind: 'openrouter'
      label: string
      apiKeyEnv: string
    }
  | {
      kind: 'chatgpt'
      label: string
    }

// Managed providers declare only the environment variable name. Keys are read from the named
// environment variable on the server and are never included in this config.
export const PROVIDERS = {
  openrouter: {
    kind: 'openrouter',
    label: 'OpenRouter',
    apiKeyEnv: 'OPENROUTER_API_KEY',
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

interface ModelDefinitionBase {
  id: string
  label: string
  modelId: string
  supportsImageInput: boolean
  price: {
    input: number
    output: number
  }
}

export type ModelDefinition = ModelDefinitionBase & (
  | {
      provider: 'openrouter'
      routingProvider: string
    }
  | {
      provider: 'chatgpt'
    }
)

// `id` is Loora's stable key. `modelId` is the exact id sent to the provider.
// Prices are USD per 1M tokens and power the existing usage limits.
export const MODELS = [
  {
    id: 'mini',
    label: 'Mini',
    provider: 'openrouter',
    modelId: 'minimax/minimax-m3',
    routingProvider: 'minimax',
    supportsImageInput: true,
    price: { input: 1.2, output: 4.9 },
  },
  {
    id: 'max',
    label: 'Max',
    provider: 'openrouter',
    modelId: 'z-ai/glm-5.2',
    routingProvider: 'wafer/fp4',
    supportsImageInput: false,
    price: { input: 1.5, output: 4.2 },
  },
  {
    id: 'max-fast',
    label: 'Max Fast',
    provider: 'openrouter',
    modelId: 'z-ai/glm-5.2',
    routingProvider: 'wafer/fast',
    supportsImageInput: false,
    price: { input: 4, output: 12 },
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
