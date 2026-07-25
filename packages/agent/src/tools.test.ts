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
      'createPage',
      'readPage',
      'updatePage',
      'editPageItems',
      'duplicatePage',
      'reorderPages',
      'deletePage',
      'readElement',
      'deleteElement',
      'viewCanvas',
      'viewElement',
      'viewPage',
      'readElementLogs',
      'arrangeElements',
      'askQuestion',
    ])
    expect(tools.createElement.execute).toBeUndefined()
    expect(tools.updateElement.execute).toBeUndefined()
    expect(tools.createPage.execute).toBeUndefined()
    expect(tools.readPage.execute).toBeUndefined()
    expect(tools.updatePage.execute).toBeUndefined()
    expect(tools.editPageItems.execute).toBeUndefined()
    expect(tools.duplicatePage.execute).toBeUndefined()
    expect(tools.reorderPages.execute).toBeUndefined()
    expect(tools.viewPage.execute).toBeUndefined()
  })
})
