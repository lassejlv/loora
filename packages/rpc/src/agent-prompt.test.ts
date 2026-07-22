import { describe, expect, test } from 'bun:test'
import { agentSystemPromptSchema } from './agent-prompt'

describe('agentSystemPromptSchema', () => {
  test('trims valid prompts', () => {
    expect(agentSystemPromptSchema.parse('  Prefer concise replies.  ')).toBe(
      'Prefer concise replies.',
    )
  })

  test('accepts 8,000 characters and rejects more', () => {
    expect(agentSystemPromptSchema.parse('a'.repeat(8_000))).toHaveLength(8_000)
    expect(agentSystemPromptSchema.safeParse('a'.repeat(8_001)).success).toBe(false)
  })
})
