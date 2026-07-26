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
      'createPage',
      'insertNodes',
      'patchNodes',
      'moveNodes',
      'deleteNodes',
      'readNode',
      'readTree',
      'searchNodes',
      'createComponent',
      'createInstance',
      'setTokens',
      'viewNode',
      'viewPage',
      'viewCanvas',
      'askQuestion',
    ])
    for (const tool of Object.values(tools)) {
      expect(tool.execute).toBeUndefined()
    }
  })
})
