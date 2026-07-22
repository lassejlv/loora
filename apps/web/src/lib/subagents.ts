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

type SubagentStreamResult = {
  text: PromiseLike<string>
  totalUsage: PromiseLike<{
    inputTokens?: number
    outputTokens?: number
  }>
}

export async function runSubagentStream<TOptions>(
  agent: { stream(options: TOptions): PromiseLike<SubagentStreamResult> },
  options: TOptions,
) {
  const stream = await agent.stream(options)
  const [text, totalUsage] = await Promise.all([stream.text, stream.totalUsage])
  return { text, totalUsage }
}

export function subagentFailureMessage(
  error: unknown,
  { aborted, usingChatGPT }: { aborted: boolean; usingChatGPT: boolean },
) {
  if (aborted) return 'Cancelled by the user.'

  const message = error instanceof Error ? error.message : ''
  const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
    ? (error as { statusCode?: unknown }).statusCode
    : undefined

  if (statusCode === 408 || /time(?:d)?\s*out|timeout/i.test(message)) {
    return 'Timed out after 90 seconds.'
  }
  if (statusCode === 429) return 'The model is temporarily rate limited. Try again shortly.'
  if (usingChatGPT && (statusCode === 401 || statusCode === 403)) {
    return 'Reconnect ChatGPT in Settings and try again.'
  }
  return 'The selected model could not run this sub-agent.'
}

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
