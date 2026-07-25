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

  it('routes the managed models through Neon under the Loora label', () => {
    const flash = getModel('gemini-3-5-flash')
    const pro = getModel('gemini-3-1-pro')
    const flashLite = getModel('gemini-3-1-flash-lite')

    expect(flash).toMatchObject({
      label: 'Gemini 3.5 Flash',
      modelId: 'gemini-3-5-flash',
      supportsImageInput: true,
      price: { input: 1.5, output: 9 },
    })
    expect(pro).toMatchObject({
      label: 'Gemini 3.1 Pro',
      modelId: 'gemini-3-1-pro',
      supportsImageInput: true,
      price: {
        input: 2,
        output: 12,
        contextOver200k: { input: 4, output: 18 },
      },
    })
    expect(flashLite).toMatchObject({
      label: 'Gemini 3.1 Flash Lite',
      modelId: 'gemini-3-1-flash-lite',
      supportsImageInput: true,
      price: { input: 0.25, output: 1.5 },
    })
    expect(getProvider(pro.provider)).toEqual({
      kind: 'neon',
      label: 'Loora',
      requiredEnv: ['NEON_AI_GATEWAY_BASE_URL', 'NEON_AI_GATEWAY_TOKEN'],
    })
  })

  it('normalizes unsupported ChatGPT reasoning efforts', () => {
    expect(getChatGPTReasoningEffort('high')).toBe('high')
    expect(getChatGPTReasoningEffort('unsupported')).toBe(DEFAULT_CHATGPT_REASONING_EFFORT)
  })

  it('routes OpenRouter Auto through the user-funded OpenRouter provider', () => {
    const auto = getModel('openrouter-auto')

    expect(auto).toMatchObject({
      label: 'OpenRouter Auto',
      provider: 'openrouter',
      modelId: 'openrouter/auto',
      supportsImageInput: false,
      price: { input: 0, output: 0 },
    })
    expect(getProvider(auto.provider)).toEqual({
      kind: 'openrouter',
      label: 'OpenRouter',
    })
  })

  it('routes custom API key models through their native providers', () => {
    expect(getModel('google-gemini-3-5-flash')).toMatchObject({
      provider: 'google',
      modelId: 'gemini-3.5-flash',
      supportsImageInput: true,
      price: { input: 0, output: 0 },
    })
    expect(getModel('google-gemini-3-1-pro')).toMatchObject({
      provider: 'google',
      modelId: 'gemini-3.1-pro-preview',
    })
    expect(getProvider('google')).toEqual({
      kind: 'byok',
      label: 'Google',
      credentialProvider: 'google',
    })

    expect(getModel('openai-gpt-5-6-sol')).toMatchObject({
      provider: 'openai',
      modelId: 'gpt-5.6-sol',
      price: { input: 0, output: 0 },
    })
    expect(getProvider('openai')).toEqual({
      kind: 'byok',
      label: 'OpenAI',
      credentialProvider: 'openai',
    })

    expect(getModel('anthropic-claude-opus-5')).toMatchObject({
      provider: 'anthropic',
      modelId: 'claude-opus-5',
      supportsImageInput: true,
      price: { input: 0, output: 0 },
    })
    expect(getProvider('anthropic')).toEqual({
      kind: 'byok',
      label: 'Anthropic',
      credentialProvider: 'anthropic',
    })
  })
})
