import { describe, expect, it, vi } from 'vitest'
import { createAssistantTools, unwrapToolResult } from './tools'
import { ASSISTANT_TOOL_NAMES, isAssistantToolName } from './protocol'

function textResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    ...(isError ? { isError: true } : {}),
  }
}

async function run(
  tools: ReturnType<typeof createAssistantTools>,
  name: string,
  input: unknown,
) {
  const tool = tools[name]
  const execute = tool?.execute
  if (!execute) throw new Error(`Tool "${name}" has no execute`)
  return execute(input as never, {
    toolCallId: 'call_1',
    messages: [],
  } as never)
}

describe('unwrapToolResult', () => {
  it('parses the JSON an MCP text part carries', () => {
    expect(unwrapToolResult(textResult({ revision: 4 }))).toEqual({
      value: { revision: 4 },
      image: undefined,
      isError: false,
    })
  })

  it('keeps text that is not JSON as text', () => {
    expect(
      unwrapToolResult({ content: [{ type: 'text', text: 'not json' }] }).value,
    ).toBe('not json')
  })

  it('reports a failed call rather than hiding it', () => {
    expect(unwrapToolResult(textResult({ error: 'locked' }, true))).toMatchObject({
      isError: true,
    })
  })

  it('survives a result with no content at all', () => {
    expect(unwrapToolResult(undefined)).toEqual({
      value: null,
      image: undefined,
      isError: false,
    })
  })
})

describe('createAssistantTools', () => {
  it('exposes exactly the catalog the protocol names', () => {
    const tools = createAssistantTools({
      execute: async () => textResult({}),
      target: { designId: 'design_1', draftId: null },
    })
    expect(Object.keys(tools).sort()).toEqual([...ASSISTANT_TOOL_NAMES].sort())
    for (const name of Object.keys(tools)) {
      expect(isAssistantToolName(name)).toBe(true)
    }
  })

  it('injects the open document and never lets the model name one', async () => {
    const execute = vi.fn(async () => textResult({ ok: true }))
    const tools = createAssistantTools({
      execute,
      target: { designId: 'design_1', draftId: null },
    })
    await run(tools, 'readTree', { depth: 3, designId: 'someone-elses' })
    expect(execute).toHaveBeenCalledWith('readTree', {
      depth: 3,
      designId: 'design_1',
    })
  })

  it('carries the branch when one is open', async () => {
    const execute = vi.fn(async () => textResult({ ok: true }))
    const tools = createAssistantTools({
      execute,
      target: { designId: 'design_1', draftId: 'draft_9' },
    })
    await run(tools, 'searchNodes', { query: 'hero' })
    expect(execute).toHaveBeenCalledWith('searchNodes', {
      query: 'hero',
      designId: 'design_1',
      draftId: 'draft_9',
    })
  })

  it('pauses on deleting and sends the executor its confirmation', async () => {
    const execute = vi.fn(async () => textResult({ deletedNodeIds: ['n1'] }))
    const tools = createAssistantTools({
      execute,
      target: { designId: 'design_1', draftId: null },
    })
    expect(tools.deleteNodes.needsApproval).toBe(true)
    await run(tools, 'deleteNodes', { nodeIds: ['n1'] })
    expect(execute).toHaveBeenCalledWith('deleteNodes', {
      nodeIds: ['n1'],
      designId: 'design_1',
      confirmed: true,
    })
  })

  it('hands a failed call back as data the model can recover from', async () => {
    const tools = createAssistantTools({
      execute: async () => textResult({ error: 'Node "n1" is locked' }, true),
      target: { designId: 'design_1', draftId: null },
    })
    await expect(run(tools, 'patchNodes', { changes: [] })).resolves.toMatchObject({
      failed: 'patchNodes',
      error: 'Node "n1" is locked',
    })
  })

  it('reports every call it starts, in order', async () => {
    const onCall = vi.fn()
    const tools = createAssistantTools({
      execute: async () => textResult({}),
      target: { designId: 'design_1', draftId: null },
      onCall,
    })
    await run(tools, 'getDesignContext', { depth: 4 })
    await run(tools, 'readNode', { ref: { nodeId: 'n1', instancePath: [] } })
    expect(onCall.mock.calls.map(([name]) => name)).toEqual([
      'getDesignContext',
      'readNode',
    ])
  })

  it('returns screenshot pixels as a file part for a model that takes them', async () => {
    const tools = createAssistantTools({
      execute: async () => ({
        content: [
          { type: 'text', text: JSON.stringify({ width: 1440 }) },
          { type: 'image', data: 'AAAA', mimeType: 'image/png' },
        ],
      }),
      target: { designId: 'design_1', draftId: null },
    })
    const output = (await run(tools, 'getScreenshot', { width: 1440 })) as {
      image: string | null
    }
    expect(output.image).toBe('AAAA')
    const modelOutput = await tools.getScreenshot.toModelOutput?.({
      toolCallId: 'call_1',
      input: {},
      output,
    } as never)
    expect(modelOutput).toMatchObject({
      type: 'content',
      value: expect.arrayContaining([
        expect.objectContaining({ type: 'file', mediaType: 'image/png' }),
      ]),
    })
  })

  it('describes the screenshot in words when the model cannot see images', async () => {
    const tools = createAssistantTools({
      execute: async () => ({
        content: [
          { type: 'text', text: JSON.stringify({ width: 1440 }) },
          { type: 'image', data: 'AAAA', mimeType: 'image/png' },
        ],
      }),
      target: { designId: 'design_1', draftId: null },
      imageInputs: false,
    })
    const output = await run(tools, 'getScreenshot', { width: 1440 })
    const modelOutput = await tools.getScreenshot.toModelOutput?.({
      toolCallId: 'call_1',
      input: {},
      output,
    } as never)
    expect(modelOutput).toMatchObject({ type: 'text' })
    expect((modelOutput as { value: string }).value).not.toContain('AAAA')
  })
})
