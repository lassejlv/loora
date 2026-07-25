import { describe, expect, it } from 'bun:test'
import { convertToModelMessages, type ToolSet, type UIMessage } from 'ai'
import { createAgentBaseTools } from './tools'

describe('agent tool contracts', () => {
  it('keeps canvas mutation tools client-executed', () => {
    const tools = createAgentBaseTools({
      userId: 'user-one',
      githubConnected: false,
      imageInputsEnabled: true,
    }) as ToolSet

    expect(Object.keys(tools)).toEqual([
      'createElement',
      'createElements',
      'updateElement',
      'editElement',
      'searchCanvas',
      'reorderElements',
      'groupElements',
      'ungroupElements',
      'readElement',
      'deleteElement',
      'viewCanvas',
      'viewElement',
      'readElementLogs',
      'arrangeElements',
      'askQuestion',
    ])
    expect(tools.createElement.execute).toBeUndefined()
    expect(tools.updateElement.execute).toBeUndefined()
  })

  it('uses the Neon-compatible image result shape for completed canvas views', async () => {
    const tools = createAgentBaseTools({
      userId: 'user-one',
      githubConnected: false,
      imageInputsEnabled: true,
      useLegacyNeonImageOutput: true,
    }) as ToolSet
    const messages = [{
      id: 'assistant-view',
      role: 'assistant',
      parts: [{
        type: 'tool-viewCanvas',
        toolCallId: 'view-one',
        state: 'output-available',
        input: { focus: 'layout' },
        output: { image: 'data:image/png;base64,aGVsbG8=' },
      }],
    }] as UIMessage[]

    const converted = await convertToModelMessages(messages, { tools })

    expect(converted[1]).toMatchObject({
      role: 'tool',
      content: [{
        type: 'tool-result',
        output: {
          type: 'content',
          value: [{
            type: 'image-data',
            data: 'aGVsbG8=',
            mediaType: 'image/png',
          }],
        },
      }],
    })
    expect(JSON.stringify(converted)).not.toContain('[object Object]')
  })
})
