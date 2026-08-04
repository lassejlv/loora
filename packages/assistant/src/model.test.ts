import { describe, expect, it } from 'vitest'
import { selectAssistantModel } from './model'

describe('selectAssistantModel', () => {
  it('uses the preferred model when the account provides it', () => {
    expect(selectAssistantModel(['gpt-5.5', 'gpt-5.6-terra'], 'gpt-5.6-terra')).toBe(
      'gpt-5.6-terra',
    )
  })

  it('falls back to an available account model', () => {
    expect(selectAssistantModel(['gpt-5.5'], 'gpt-5.6-terra')).toBe('gpt-5.5')
    expect(selectAssistantModel([], 'gpt-5.6-terra')).toBeUndefined()
  })
})
