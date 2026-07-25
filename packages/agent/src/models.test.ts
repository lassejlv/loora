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

  it('routes the managed model through Neon under the Loora label', () => {
    const model = getModel('gemini-3-5-flash')

    expect(model).toMatchObject({
      label: 'Gemini 3.5 Flash',
      modelId: 'gemini-3-5-flash',
      supportsImageInput: true,
      price: { input: 1.5, output: 9 },
    })
    expect(getProvider(model.provider)).toEqual({
      kind: 'neon',
      label: 'Loora',
      requiredEnv: ['NEON_AI_GATEWAY_BASE_URL', 'NEON_AI_GATEWAY_TOKEN'],
    })
  })

  it('normalizes unsupported ChatGPT reasoning efforts', () => {
    expect(getChatGPTReasoningEffort('high')).toBe('high')
    expect(getChatGPTReasoningEffort('unsupported')).toBe(DEFAULT_CHATGPT_REASONING_EFFORT)
  })
})
