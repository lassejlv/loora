import { describe, expect, test } from 'bun:test'
import { composeAgentSystemPrompt } from '#/lib/agent-system-prompt'

describe('composeAgentSystemPrompt', () => {
  test('leaves the built-in prompt unchanged for empty instructions', () => {
    expect(composeAgentSystemPrompt('built-in', '')).toBe('built-in')
    expect(composeAgentSystemPrompt('built-in', '   \n ')).toBe('built-in')
  })

  test('keeps the complete built-in prompt first and appends trimmed instructions once', () => {
    const result = composeAgentSystemPrompt('first\nsecond', '  Prefer concise replies.  ')

    expect(result.startsWith('first\nsecond')).toBe(true)
    expect(result.indexOf('Prefer concise replies.')).toBeGreaterThan('first\nsecond'.length)
    expect(result.match(/Prefer concise replies\./g)).toHaveLength(1)
    expect(result).not.toContain('  Prefer concise replies.  ')
  })
})
