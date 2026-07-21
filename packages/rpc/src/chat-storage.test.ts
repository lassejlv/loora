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
            type: 'tool-listGitHubRepositories',
            toolCallId: 'repos-1',
            state: 'output-available',
            input: { query: 'acme', injected: 'do not save me' },
            output: {
              repositories: [{ fullName: 'acme/private-site', private: true }],
              total: 1,
            },
          },
          {
            type: 'tool-readRepositoryFile',
            toolCallId: 'read-1',
            state: 'output-available',
            input: { repository: 'acme/site', path: 'src/app.ts', injected: 'do not save me' },
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
            input: { repository: 'acme/site', path: 'public/hero.png' },
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
    expect(JSON.stringify(message)).not.toContain('acme/private-site')
    expect(JSON.stringify(message)).not.toContain('do not save me')
    expect(message.parts[1]).toMatchObject({
      input: { repository: 'acme/site', path: 'src/app.ts' },
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

  it('keeps bounded sub-agent task cards without arbitrary payloads', () => {
    const oversized = 'x'.repeat(30_000)
    const [message] = sanitizeChatMessagesForStorage([
      {
        id: 'assistant-3',
        role: 'assistant',
        parts: [{
          type: 'tool-delegateTasks',
          toolCallId: 'delegate-1',
          state: 'output-available',
          input: {
            tasks: [
              { name: 'Visuals', task: 'Draft the visual direction', injected: 'drop me' },
              { name: 'Copy', task: 'Draft the copy' },
            ],
            injected: 'drop me',
          },
          output: {
            workers: [{
              id: 'worker-1',
              name: 'Visuals',
              task: 'Draft the visual direction',
              status: 'completed',
              result: oversized,
              injected: 'drop me',
            }],
            injected: 'drop me',
          },
        }],
      },
    ])

    expect(JSON.stringify(message)).not.toContain('drop me')
    expect((message.parts[0] as unknown as {
      output: { workers: { result: string }[] }
    }).output.workers[0].result).toHaveLength(24_000)
    expect(message.parts[0]).toMatchObject({
      input: {
        tasks: [
          { name: 'Visuals', task: 'Draft the visual direction' },
          { name: 'Copy', task: 'Draft the copy' },
        ],
      },
      output: {
        workers: [{
          id: 'worker-1',
          status: 'completed',
        }],
      },
    })
  })
})
