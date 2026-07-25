import { describe, expect, it } from 'bun:test'
import type { UIMessage } from 'ai'
import {
  boundedJson,
  bridgeCompletedToolTurn,
  canvasForPrompt,
  messagesForModel,
  modelSupportsImageInput,
  sanitizeModelNames,
  withoutImageParts,
} from './messages'

describe('AI image input capabilities', () => {
  it('reads image support from the model catalog', () => {
    expect(modelSupportsImageInput('gemini-3-5-flash')).toBe(true)
    expect(modelSupportsImageInput('gpt-5.6-sol')).toBe(true)
    expect(modelSupportsImageInput('unknown')).toBe(true)
  })

  it('removes image parts before messages reach the provider', () => {
    const messages: UIMessage[] = [
      {
        id: 'mixed',
        role: 'user',
        parts: [
          { type: 'text', text: 'Update the design' },
          { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,test' },
          { type: 'file', mediaType: 'application/pdf', url: 'data:application/pdf;base64,test' },
        ],
      },
      {
        id: 'image-only',
        role: 'user',
        parts: [{ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,test' }],
      },
    ]

    expect(withoutImageParts(messages, false)).toEqual([
      {
        id: 'mixed',
        role: 'user',
        parts: [
          { type: 'text', text: 'Update the design' },
          { type: 'file', mediaType: 'application/pdf', url: 'data:application/pdf;base64,test' },
        ],
      },
    ])

    expect(withoutImageParts(messages, true)).toBe(messages)
  })
})

describe('Gemini tool continuation', () => {
  it('adds a fresh user boundary after a completed tool turn', () => {
    const messages = [
      {
        id: 'assistant-tool',
        role: 'assistant',
        parts: [{
          type: 'tool-createElement',
          toolCallId: 'call-one',
          state: 'output-available',
          input: { name: 'Hero' },
          output: { id: 'hero-one', render: 'ok' },
        }],
      },
    ] as UIMessage[]

    const bridged = bridgeCompletedToolTurn(messages)

    expect(bridged).toHaveLength(2)
    expect(bridged[1]).toMatchObject({
      role: 'user',
      parts: [{
        type: 'text',
        text: 'Continue from the completed tool result above. Do not repeat a successful tool call.',
      }],
    })
    expect(messages).toHaveLength(1)
  })

  it('leaves ordinary assistant replies unchanged', () => {
    const messages = [{
      id: 'assistant-text',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Done.' }],
    }] as UIMessage[]

    expect(bridgeCompletedToolTurn(messages)).toBe(messages)
  })
})

describe('model message preparation', () => {
  it('keeps the historical-code and bounded-serialization thresholds exact', () => {
    const prepared = (code: string) => messagesForModel([
      {
        id: 'old',
        role: 'assistant',
        parts: [{
          type: 'tool-updateElement',
          state: 'output-available',
          toolCallId: 'update',
          input: { id: 'one', code },
          output: { code },
        }],
      },
      ...Array.from({ length: 3 }, (_, index) => ({
        id: `recent-${index}`,
        role: 'user' as const,
        parts: [{ type: 'text' as const, text: `recent ${index}` }],
      })),
    ] satisfies UIMessage[], true)

    expect(JSON.stringify(prepared('x'.repeat(280)))).not.toContain('[truncated')
    expect(JSON.stringify(prepared('x'.repeat(281)))).toContain('[truncated, 281 chars')
    expect(boundedJson('1234', 6)).toBe('"1234"')
    expect(boundedJson('12345', 6)).toBe('"12345…[truncated]')
  })

  it('compacts old code, reasoning, images, and repository payloads', () => {
    const oldCode = 'x'.repeat(400)
    const messages = [
      {
        id: 'old',
        role: 'assistant' as const,
        parts: [
          { type: 'reasoning' as const, text: 'old reasoning' },
          { type: 'file' as const, mediaType: 'image/png', url: 'old-image' },
          { type: 'file' as const, mediaType: 'application/pdf', url: 'old-pdf' },
          {
            type: 'tool-updateElement' as const,
            state: 'output-available' as const,
            toolCallId: 'update',
            input: { id: 'one', code: oldCode },
            output: { code: oldCode, image: 'secret-image' },
          },
          {
            type: 'tool-readRepositoryFile' as const,
            state: 'output-available' as const,
            toolCallId: 'repo',
            input: { path: 'src/app.ts' },
            output: {
              repository: 'owner/repo',
              path: 'src/app.ts',
              source: 'sensitive source',
              total: 1,
            },
          },
        ],
      },
      ...Array.from({ length: 3 }, (_, index) => ({
        id: `recent-${index}`,
        role: 'user' as const,
        parts: [{ type: 'text' as const, text: `recent ${index}` }],
      })),
    ] satisfies UIMessage[]

    const [old] = messagesForModel(messages, true)
    expect(old.parts.some((part) => part.type === 'reasoning')).toBe(false)
    expect(old.parts.some((part) => part.type === 'file')).toBe(false)
    expect(JSON.stringify(old)).toContain('[truncated, 400 chars')
    expect(JSON.stringify(old)).not.toContain('secret-image')
    expect(JSON.stringify(old)).not.toContain('sensitive source')
  })

  it('summarizes large canvas code and scrubs upstream model names', () => {
    const summaries = canvasForPrompt([
      {
        id: 'one',
        name: 'Page',
        x: 0,
        y: 0,
        w: 1200,
        h: 2000,
        code: 'a'.repeat(1200),
      },
      {
        id: 'two',
        name: 'Page',
        x: 0,
        y: 0,
        w: 1200,
        h: 2000,
        code: 'b'.repeat(1201),
      },
    ])

    expect(summaries[0].code).toHaveLength(1200)
    expect(summaries[0].code).not.toContain('truncated')
    expect(summaries[1].code).toContain('truncated — 1201 chars total')
    expect(sanitizeModelNames('gemini-3-5-flash failed')).toBe('Gemini 3.5 Flash failed')
  })
})
