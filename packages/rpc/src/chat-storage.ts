import type { UIMessage } from 'ai'

const repositoryTools = new Set([
  'listRepositoryTree',
  'searchRepositoryCode',
  'readRepositoryFile',
  'viewRepositoryImage',
])

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
  if (name === 'listRepositoryTree') {
    return {
      pathPrefix: input.pathPrefix,
      depth: input.depth,
      includeGenerated: input.includeGenerated,
    }
  }
  if (name === 'searchRepositoryCode') {
    return {
      query: input.query,
      pathPrefix: input.pathPrefix,
      extension: input.extension,
      limit: input.limit,
    }
  }
  if (name === 'readRepositoryFile') {
    return {
      path: input.path,
      startLine: input.startLine,
      endLine: input.endLine,
    }
  }
  return { path: input.path }
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

function sanitizePart(value: unknown): UIMessage['parts'][number] | null {
  const part = record(value)
  if (!part || typeof part.type !== 'string') return null
  if (part.type === 'file' || part.type === 'tool-loadSkill') return null

  const name = toolName(part)
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
