import { describe, expect, it } from 'bun:test'
import { normalizeNeonPrompt } from './neon-compat'

describe('Neon AI SDK compatibility', () => {
  it('flattens AI SDK 7 image data in user and tool messages', () => {
    const prompt = [{
      role: 'user',
      content: [{
        type: 'file',
        mediaType: 'image/png',
        data: { type: 'data', data: 'user-image' },
      }],
    }, {
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'view-one',
        toolName: 'viewCanvas',
        output: {
          type: 'content',
          value: [{
            type: 'file',
            mediaType: 'image/png',
            data: { type: 'data', data: 'tool-image' },
          }],
        },
      }],
    }]

    expect(normalizeNeonPrompt(prompt)).toEqual([{
      role: 'user',
      content: [{
        type: 'file',
        mediaType: 'image/png',
        data: 'user-image',
      }],
    }, {
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'view-one',
        toolName: 'viewCanvas',
        output: {
          type: 'content',
          value: [{
            type: 'image-data',
            mediaType: 'image/png',
            data: 'tool-image',
          }],
        },
      }],
    }])
  })

  it('leaves ordinary prompt parts unchanged', () => {
    const prompt = [{
      role: 'user',
      content: [{ type: 'text', text: 'Hello' }],
    }]

    expect(normalizeNeonPrompt(prompt)).toEqual(prompt)
  })
})
