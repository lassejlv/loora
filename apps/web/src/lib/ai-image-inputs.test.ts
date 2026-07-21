import { describe, expect, it } from 'bun:test'
import type { UIMessage } from 'ai'
import { modelSupportsImageInput, withoutImageParts } from './ai-image-inputs'

describe('AI image input capabilities', () => {
  it('reads image support from the model catalog', () => {
    // Every current catalog model supports image input; unknown ids default
    // to true so a stale localStorage model never silently drops snapshots.
    expect(modelSupportsImageInput('loora-mini')).toBe(true)
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
