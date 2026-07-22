import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_CHATGPT_REASONING_EFFORT,
  DEFAULT_MODEL,
  getChatGPTReasoningEffort,
  getModel,
  getProvider,
} from './models'

describe('agent model policy', () => {
  it('keeps unknown model selections on the existing default', () => {
    expect(getModel('unknown').id).toBe(DEFAULT_MODEL)
    expect(DEFAULT_MODEL).toBe('mini')
    expect(getProvider('openrouter')).toMatchObject({
      apiKeyEnv: 'OPENROUTER_API_KEY',
    })
    expect(getModel('mini')).toMatchObject({
      modelId: 'openrouter/free',
      routingProvider: null,
      supportsImageInput: true,
      price: { input: 0, output: 0 },
    })
    expect(getModel('max')).toMatchObject({
      modelId: 'z-ai/glm-5.2',
      routingProvider: 'wafer/fp4',
    })
  })

  it('normalizes unsupported ChatGPT reasoning efforts', () => {
    expect(getChatGPTReasoningEffort('high')).toBe('high')
    expect(getChatGPTReasoningEffort('unsupported')).toBe(DEFAULT_CHATGPT_REASONING_EFFORT)
  })
})
