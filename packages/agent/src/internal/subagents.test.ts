import { describe, expect, it } from 'bun:test'
import { ToolLoopAgent } from 'ai'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import {
  currentTurnSubagentImageParts,
  MAX_SUBAGENT_STEPS,
  prepareSubagentStep,
  runParallelSubagents,
  runSubagentStream,
  subagentFailureMessage,
  truncateSubagentResult,
  type DelegatedTask,
  type SubagentBatch,
  type SubagentOutcome,
} from './subagents'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('runParallelSubagents', () => {
  it('starts every worker before waiting and keeps task ordering as they finish', async () => {
    const tasks: DelegatedTask[] = [
      { name: 'Structure', task: 'Draft the page structure' },
      { name: 'Visuals', task: 'Draft the visual direction' },
      { name: 'Copy', task: 'Draft the page copy' },
    ]
    const runs = tasks.map(() => deferred<SubagentOutcome>())
    const started: number[] = []
    const stream = runParallelSubagents(tasks, (_task, index) => {
      started.push(index)
      return runs[index].promise
    })

    const initial = await stream.next()
    expect(started).toEqual([0, 1, 2])
    expect((initial.value as SubagentBatch).workers.map((worker) => worker.status)).toEqual([
      'running',
      'running',
      'running',
    ])

    runs[1].resolve({ result: 'Visual result' })
    const partial = await stream.next()
    expect((partial.value as SubagentBatch).workers.map((worker) => worker.status)).toEqual([
      'running',
      'completed',
      'running',
    ])
    expect((partial.value as SubagentBatch).workers[1].result).toBe('Visual result')

    runs[0].resolve({ error: 'Worker failed' })
    const failed = await stream.next()
    expect((failed.value as SubagentBatch).workers[0]).toMatchObject({
      id: 'worker-1',
      status: 'failed',
      error: 'Worker failed',
    })

    runs[2].resolve({ result: 'Copy result' })
    const complete = await stream.next()
    expect((complete.value as SubagentBatch).workers.map((worker) => worker.name)).toEqual([
      'Structure',
      'Visuals',
      'Copy',
    ])
    expect((complete.value as SubagentBatch).workers.map((worker) => worker.status)).toEqual([
      'failed',
      'completed',
      'completed',
    ])
    expect((await stream.next()).done).toBe(true)
  })

  it('truncates oversized deliverables with a visible marker', () => {
    expect(truncateSubagentResult('abcdef', 4)).toBe(
      'abcd\n…[sub-agent result truncated]',
    )
  })
})

describe('runSubagentStream', () => {
  it('uses model streaming instead of non-streaming generation', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('non-streaming generation is unsupported')
      },
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta', id: 'text-1', delta: 'Streamed result' },
            { type: 'text-end', id: 'text-1' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: {
                inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 34, text: 34, reasoning: 0 },
              },
            },
          ],
        }),
      },
    })
    const agent = new ToolLoopAgent({ model })
    const abortController = new AbortController()

    const result = await runSubagentStream(agent, {
      prompt: 'Draft a concept',
      abortSignal: abortController.signal,
      timeout: 90_000,
    })

    expect(model.doGenerateCalls).toHaveLength(0)
    expect(model.doStreamCalls).toHaveLength(1)
    expect(model.doStreamCalls[0].abortSignal?.aborted).toBe(false)
    abortController.abort()
    expect(model.doStreamCalls[0].abortSignal?.aborted).toBe(true)
    expect(result).toMatchObject({
      text: 'Streamed result',
      totalUsage: { inputTokens: 12, outputTokens: 34 },
    })
    expect(result.steps).toHaveLength(1)
  })

  it('propagates stream failures for worker-level handling', async () => {
    const failure = Object.assign(new Error('provider failed'), { statusCode: 429 })
    const agent = {
      stream: async () => {
        throw failure
      },
    }

    await expect(runSubagentStream(agent, {})).rejects.toBe(failure)
  })
})

describe('sub-agent context and loop bounds', () => {
  it('reserves the eighth and final worker step for a prose deliverable', () => {
    expect(prepareSubagentStep({ stepNumber: MAX_SUBAGENT_STEPS - 2 })).toEqual({})
    expect(prepareSubagentStep({ stepNumber: MAX_SUBAGENT_STEPS - 1 })).toEqual({
      toolChoice: 'none',
    })
  })

  it('forwards only the latest image from the current user turn', () => {
    const messages = [
      {
        id: 'old-user',
        role: 'user' as const,
        parts: [{ type: 'file' as const, mediaType: 'image/png', url: 'old-image' }],
      },
      {
        id: 'assistant',
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, text: 'Ready' }],
      },
      {
        id: 'current-user',
        role: 'user' as const,
        parts: [
          { type: 'file' as const, mediaType: 'image/jpeg', url: 'first-current-image' },
          { type: 'text' as const, text: 'Review this' },
          { type: 'file' as const, mediaType: 'image/png', url: 'latest-current-image' },
        ],
      },
    ]

    expect(currentTurnSubagentImageParts(messages, true)).toEqual([
      { type: 'file', mediaType: 'image/png', url: 'latest-current-image' },
    ])
    expect(currentTurnSubagentImageParts(messages, false)).toEqual([])
  })
})

describe('subagentFailureMessage', () => {
  it('distinguishes cancellation, timeout, rate limits, and ChatGPT authentication', () => {
    expect(subagentFailureMessage(new Error('anything'), {
      aborted: true,
      usingChatGPT: false,
    })).toBe('Cancelled by the user.')
    expect(subagentFailureMessage(new Error('Request timeout'), {
      aborted: false,
      usingChatGPT: false,
    })).toBe('Timed out after 90 seconds.')
    expect(subagentFailureMessage({ statusCode: 429 }, {
      aborted: false,
      usingChatGPT: false,
    })).toBe('The model is temporarily rate limited. Try again shortly.')
    expect(subagentFailureMessage({ statusCode: 401 }, {
      aborted: false,
      usingChatGPT: true,
    })).toBe('Reconnect ChatGPT in Settings and try again.')
  })

  it('keeps unknown provider failures safe', () => {
    expect(subagentFailureMessage(new Error('secret upstream response'), {
      aborted: false,
      usingChatGPT: false,
    })).toBe('The selected model could not run this sub-agent.')
  })
})
