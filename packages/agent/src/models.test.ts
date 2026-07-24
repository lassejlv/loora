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
  })

  it('routes the managed models through their OpenCode Go protocols', () => {
    const mini = getModel('mini')
    const max = getModel('max')

    expect(mini.modelId).toBe('minimax-m3')
    expect(getProvider(mini.provider)).toMatchObject({
      kind: 'anthropic-compatible',
      baseURL: 'https://opencode.ai/zen/go/v1',
      apiKeyEnv: 'OPENCODE_GO_API_KEY',
    })
    expect(max.modelId).toBe('glm-5.2')
    expect(getProvider(max.provider)).toMatchObject({
      kind: 'openai-compatible',
      baseURL: 'https://opencode.ai/zen/go/v1',
      apiKeyEnv: 'OPENCODE_GO_API_KEY',
    })
  })

  it('normalizes unsupported ChatGPT reasoning efforts', () => {
    expect(getChatGPTReasoningEffort('high')).toBe('high')
    expect(getChatGPTReasoningEffort('unsupported')).toBe(DEFAULT_CHATGPT_REASONING_EFFORT)
  })
})
