import { describe, expect, test } from 'bun:test'
import {
  buildAgentSystemPrompt,
  composeAgentSystemPrompt,
  renderPromptTemplate,
} from './prompts'
import {
  createCanvasDocument,
  createPageNode,
  createTextNode,
} from '@loora/canvas/model'

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
    const document = createCanvasDocument('Website', 'design-one')
    const page = createPageNode('Home', { id: 'home' })
    const heading = createTextNode('Welcome', {
      id: 'one',
      parentId: page.id,
    })
    document.nodes = { [page.id]: page, [heading.id]: heading }
    const result = buildAgentSystemPrompt({
      customInstructions: 'Prefer concise replies.',
      forceCanvasAction: true,
      imageInputsEnabled: false,
      githubConnected: true,
      assets: [{ id: 'asset-one', name: 'Logo', mediaType: 'image/png' }],
      document,
      selectedRefs: [{ nodeId: 'one', instancePath: [] }],
    })

    expect(result).toContain('Your previous response promised a canvas change')
    expect(result).toContain('Image input is temporarily disabled')
    expect(result).toContain('GitHub is connected')
    expect(result).toContain('/api/asset/asset-one')
    expect(result).toContain('The current selection is [{"nodeId":"one","instancePath":[]}]')
    expect(result).toContain('"id":"one"')
    expect(result.match(/Prefer concise replies\./g)).toHaveLength(1)
    expect(result).toContain('You are Loora')
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
      document: createCanvasDocument(),
    })
    expect(result).not.toContain('{{')
    expect(result).not.toContain('\n\n\n')
    expect(result).toContain('After meaningful edits')
  })
})
