import { describe, expect, test } from 'bun:test'
import {
  buildAgentSystemPrompt,
  buildSubagentSystemPrompt,
  composeAgentSystemPrompt,
} from './prompts'

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

describe('agent prompt builders', () => {
  test('keeps capability-dependent instructions and request context', () => {
    const result = buildAgentSystemPrompt({
      customInstructions: 'Prefer concise replies.',
      forceCanvasAction: true,
      imageInputsEnabled: false,
      githubConnected: true,
      assets: [{ id: 'asset-one', name: 'Logo', mediaType: 'image/png' }],
      shapes: [{ id: 'one', name: 'Page', x: 0, y: 0, w: 1200, h: 800, code: '<main />' }],
      selectedIds: ['one'],
    })

    expect(result).toContain('Your previous response promised a canvas change')
    expect(result).toContain('Image input is temporarily disabled')
    expect(result).toContain('GitHub is connected')
    expect(result).toContain('/api/asset/asset-one')
    expect(result).toContain('The user currently has these element ids selected: ["one"]')
    expect(result.match(/Prefer concise replies\./g)).toHaveLength(1)
  })

  test('keeps sub-agents read-only and appends custom instructions', () => {
    const result = buildSubagentSystemPrompt('Keep it short.')
    expect(result).toContain('You cannot mutate the canvas')
    expect(result.endsWith('--- End user supplementary instructions ---')).toBe(true)
  })
})
