// Client-safe model list. Real provider model ids live server-side in api.chat.ts only.
export const MODELS = [
  { id: 'mini', label: 'Mini' },
  { id: 'max', label: 'Max' },
  { id: 'max-fast', label: 'Max Fast' },
] as const

export type ModelKey = (typeof MODELS)[number]['id']

export const DEFAULT_MODEL: ModelKey = 'mini'
