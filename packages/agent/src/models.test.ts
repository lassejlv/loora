import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_CHATGPT_REASONING_EFFORT,
  DEFAULT_MODEL,
  getChatGPTReasoningEffort,
  getModel,
} from './models'

describe('agent model policy', () => {
  it('keeps unknown model selections on the existing default', () => {
    expect(getModel('unknown').id).toBe(DEFAULT_MODEL)
    expect(getModel('mini').modelId).toBe('MiniMax-M3')
  })

  it('normalizes unsupported ChatGPT reasoning efforts', () => {
    expect(getChatGPTReasoningEffort('high')).toBe('high')
    expect(getChatGPTReasoningEffort('unsupported')).toBe(DEFAULT_CHATGPT_REASONING_EFFORT)
  })
})
