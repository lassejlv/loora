export const MAX_SUBAGENT_RESULT_CHARS = 24_000

export type DelegatedTask = {
  name: string
  task: string
}

export type SubagentWorker = DelegatedTask & {
  id: string
  status: 'running' | 'completed' | 'failed'
  result?: string
  error?: string
}

export type SubagentBatch = {
  workers: SubagentWorker[]
}

export type SubagentOutcome =
  | { result: string }
  | { error: string }

export function truncateSubagentResult(
  result: string,
  maxChars = MAX_SUBAGENT_RESULT_CHARS,
) {
  if (result.length <= maxChars) return result
  return `${result.slice(0, maxChars)}\n…[sub-agent result truncated]`
}

function snapshot(workers: SubagentWorker[]): SubagentBatch {
  return { workers: workers.map((worker) => ({ ...worker })) }
}

export async function* runParallelSubagents(
  tasks: DelegatedTask[],
  runWorker: (task: DelegatedTask, index: number) => Promise<SubagentOutcome>,
): AsyncGenerator<SubagentBatch> {
  const workers: SubagentWorker[] = tasks.map((task, index) => ({
    id: `worker-${index + 1}`,
    ...task,
    status: 'running',
  }))
  const pending = new Map(
    tasks.map((task, index) => [
      index,
      runWorker(task, index).then((outcome) => ({ index, outcome })),
    ]),
  )

  yield snapshot(workers)

  while (pending.size > 0) {
    const { index, outcome } = await Promise.race(pending.values())
    pending.delete(index)
    workers[index] = 'result' in outcome
      ? {
          ...workers[index],
          status: 'completed',
          result: truncateSubagentResult(outcome.result),
        }
      : {
          ...workers[index],
          status: 'failed',
          error: outcome.error,
        }
    yield snapshot(workers)
  }
}
