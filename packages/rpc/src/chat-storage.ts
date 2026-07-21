import type { UIMessage } from 'ai'

const repositoryTools = new Set([
  'listGitHubRepositories',
  'listRepositoryTree',
  'searchRepositoryCode',
  'readRepositoryFile',
  'viewRepositoryImage',
])

const MAX_STORED_SUBAGENT_RESULT_CHARS = 24_000

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function toolName(part: Record<string, unknown>): string | null {
  const type = typeof part.type === 'string' ? part.type : ''
  if (type.startsWith('tool-')) return type.slice(5)
  return type === 'dynamic-tool' && typeof part.toolName === 'string'
    ? part.toolName
    : null
}

function compactRepositoryInput(name: string, value: unknown) {
  const input = record(value)
  if (!input) return value
  if (name === 'listGitHubRepositories') {
    return { query: input.query }
  }
  if (name === 'listRepositoryTree') {
    return {
      repository: input.repository,
      pathPrefix: input.pathPrefix,
      depth: input.depth,
      includeGenerated: input.includeGenerated,
    }
  }
  if (name === 'searchRepositoryCode') {
    return {
      repository: input.repository,
      query: input.query,
      pathPrefix: input.pathPrefix,
      extension: input.extension,
      limit: input.limit,
    }
  }
  if (name === 'readRepositoryFile') {
    return {
      repository: input.repository,
      path: input.path,
      startLine: input.startLine,
      endLine: input.endLine,
    }
  }
  return { repository: input.repository, path: input.path }
}

function compactRepositoryOutput(value: unknown) {
  const output = record(value)
  if (!output) return { read: true }
  return {
    repository: output.repository,
    commitSha: output.commitSha,
    path: output.path,
    total: output.total,
    read: true,
    redacted: output.redacted,
    error: output.error,
    code: output.code,
  }
}

function compactDelegationTasks(value: unknown) {
  const input = record(value)
  const tasks = Array.isArray(input?.tasks) ? input.tasks : []
  return {
    tasks: tasks.slice(0, 3).flatMap((value) => {
      const task = record(value)
      if (!task) return []
      return [{
        name: String(task.name ?? '').slice(0, 80),
        task: String(task.task ?? '').slice(0, 2_000),
      }]
    }),
  }
}

function compactDelegationOutput(value: unknown) {
  const output = record(value)
  const workers = Array.isArray(output?.workers) ? output.workers : []
  return {
    workers: workers.slice(0, 3).flatMap((value) => {
      const worker = record(value)
      if (!worker) return []
      return [{
        id: String(worker.id ?? '').slice(0, 80),
        name: String(worker.name ?? '').slice(0, 80),
        task: String(worker.task ?? '').slice(0, 2_000),
        status: worker.status,
        result: typeof worker.result === 'string'
          ? worker.result.slice(0, MAX_STORED_SUBAGENT_RESULT_CHARS)
          : undefined,
        error: typeof worker.error === 'string' ? worker.error.slice(0, 500) : undefined,
      }]
    }),
  }
}

function sanitizePart(value: unknown): UIMessage['parts'][number] | null {
  const part = record(value)
  if (!part || typeof part.type !== 'string') return null
  if (part.type === 'file' || part.type === 'tool-loadSkill') return null

  const name = toolName(part)
  if (name === 'delegateTasks') {
    const next: Record<string, unknown> = {
      ...part,
      input: compactDelegationTasks(part.input),
    }
    if ('output' in part) next.output = compactDelegationOutput(part.output)
    return next as unknown as UIMessage['parts'][number]
  }

  if (name && repositoryTools.has(name)) {
    const next: Record<string, unknown> = {
      ...part,
      input: compactRepositoryInput(name, part.input),
    }
    if ('output' in part) next.output = compactRepositoryOutput(part.output)
    return next as unknown as UIMessage['parts'][number]
  }

  if (
    (name === 'viewCanvas' || name === 'viewElement') &&
    part.state === 'output-available'
  ) {
    return { ...part, output: { viewed: true } } as unknown as UIMessage['parts'][number]
  }
  return part as unknown as UIMessage['parts'][number]
}

export function sanitizeChatMessagesForStorage(messages: unknown[]): UIMessage[] {
  return messages.flatMap((value) => {
    const message = record(value)
    if (!message || !Array.isArray(message.parts)) return []
    const parts = message.parts.flatMap((part) => {
      const safe = sanitizePart(part)
      return safe ? [safe] : []
    })
    return parts.length > 0
      ? [{ ...message, parts } as unknown as UIMessage]
      : []
  })
}
