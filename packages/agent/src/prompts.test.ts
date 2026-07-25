import { describe, expect, test } from 'bun:test'
import {
  buildAgentSystemPrompt,
  composeAgentSystemPrompt,
  renderPromptTemplate,
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
      pages: [{
        id: 'home',
        name: 'Home',
        x: 1400,
        y: 0,
        w: 1200,
        items: [{ id: 'hero', elementId: 'one', height: 800 }],
      }],
      selectedIds: ['one'],
      selectedPageId: 'home',
    })

    expect(result).toContain('Your previous response promised a canvas change')
    expect(result).toContain('Image input is temporarily disabled')
    expect(result).toContain('GitHub is connected')
    expect(result).toContain('/api/asset/asset-one')
    expect(result).toContain('The user currently has these element ids selected: ["one"]')
    expect(result).toContain('The user currently has Page id "home" selected')
    expect(result).toContain('"elementId":"one"')
    expect(result.match(/Prefer concise replies\./g)).toHaveLength(1)
    expect(result).toContain('You are the design agent inside loora')
    expect(result).not.toContain('{{')
  })

  test('conditional placeholders leave no blank gaps and unknown ones throw', () => {
    expect(renderPromptTemplate('a\n{{gone}}\nb', { gone: '' })).toBe('a\n\nb')
    expect(() => renderPromptTemplate('{{ typo }}', {})).toThrow('Unknown prompt placeholder')

    const result = buildAgentSystemPrompt({
      customInstructions: '',
      imageInputsEnabled: true,
      githubConnected: false,
      assets: [],
      shapes: [],
    })
    expect(result).not.toContain('{{')
    expect(result).not.toContain('\n\n\n')
    expect(result).toContain('Verify loop')
  })
})
