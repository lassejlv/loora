import { describe, expect, it } from 'bun:test'
import type { ToolSet } from 'ai'
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
})
