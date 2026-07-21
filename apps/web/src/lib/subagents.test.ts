import { describe, expect, it } from 'bun:test'
import {
  runParallelSubagents,
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
