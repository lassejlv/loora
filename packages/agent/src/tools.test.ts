import { describe, expect, it } from 'bun:test'
import type { ToolSet } from 'ai'
import { createAgentBaseTools, createDelegateTasksTool } from './tools'

describe('agent tool contracts', () => {
  it('keeps canvas mutation tools client-executed and worker tools read-only', () => {
    const { baseTools, workerTools } = createAgentBaseTools({
      userId: 'user-one',
      shapes: [],
      githubConnected: false,
      imageInputsEnabled: true,
    })
    const tools = baseTools as ToolSet

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
    expect(Object.keys(workerTools)).toEqual([
      'listCanvasElements',
      'searchCanvasElements',
      'readCanvasElement',
    ])
  })

  it('keeps delegation bounded to two or three tasks', () => {
    const delegateTasks = createDelegateTasksTool({
      delegationUsed: false,
      run: async function* () {},
    })

    expect(delegateTasks.inputSchema.safeParse({ tasks: [{ name: 'One', task: 'Only one' }] }).success)
      .toBe(false)
    expect(delegateTasks.inputSchema.safeParse({
      tasks: [
        { name: 'One', task: 'First' },
        { name: 'Two', task: 'Second' },
      ],
    }).success).toBe(true)
  })
})
