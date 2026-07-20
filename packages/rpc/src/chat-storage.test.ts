import { describe, expect, it } from 'bun:test'
import { sanitizeChatMessagesForStorage } from './chat-storage'

describe('sanitizeChatMessagesForStorage', () => {
  it('removes repository source and image payloads while keeping useful metadata', () => {
    const [message] = sanitizeChatMessagesForStorage([
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-readRepositoryFile',
            toolCallId: 'read-1',
            state: 'output-available',
            input: { path: 'src/app.ts', injected: 'do not save me' },
            output: {
              repository: 'acme/site',
              commitSha: 'abc123',
              path: 'src/app.ts',
              content: 'private source',
              redacted: false,
            },
          },
          {
            type: 'tool-viewRepositoryImage',
            toolCallId: 'image-1',
            state: 'output-available',
            input: { path: 'public/hero.png' },
            output: {
              repository: 'acme/site',
              path: 'public/hero.png',
              data: 'very-large-base64',
              mediaType: 'image/png',
            },
          },
        ],
      },
    ])

    expect(JSON.stringify(message)).not.toContain('private source')
    expect(JSON.stringify(message)).not.toContain('very-large-base64')
    expect(JSON.stringify(message)).not.toContain('do not save me')
    expect(message.parts[0]).toMatchObject({
      input: { path: 'src/app.ts' },
      output: {
        repository: 'acme/site',
        commitSha: 'abc123',
        path: 'src/app.ts',
        read: true,
        redacted: false,
      },
    })
  })

  it('drops uploaded files and compacts canvas captures', () => {
    const [message] = sanitizeChatMessagesForStorage([
      {
        id: 'assistant-2',
        role: 'assistant',
        parts: [
          { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,secret' },
          {
            type: 'tool-viewCanvas',
            toolCallId: 'canvas-1',
            state: 'output-available',
            output: { image: 'data:image/png;base64,large' },
          },
        ],
      },
    ])

    expect(message.parts).toHaveLength(1)
    expect(message.parts[0]).toMatchObject({ output: { viewed: true } })
  })
})
