import type { UIMessage } from 'ai'
import type { CanvasElement } from '@loora/db/canvas'
import { getModel, MODELS } from './models'

export function modelSupportsImageInput(model: string): boolean {
  return getModel(model).supportsImageInput
}

const TOOL_CONTINUATION_TEXT =
  'Continue from the completed tool result above. Do not repeat a successful tool call.'

export function bridgeCompletedToolTurn(messages: UIMessage[]): UIMessage[] {
  const last = messages.at(-1)
  if (!last || last.role !== 'assistant') return messages

  const hasCompletedTool = last.parts.some((part) => {
    if (typeof part.type !== 'string' || !part.type.startsWith('tool-')) return false
    const state = 'state' in part ? part.state : undefined
    return state === 'output-available' || state === 'output-error' || state === 'output-denied'
  })
  if (!hasCompletedTool) return messages

  return [
    ...messages,
    {
      id: `${last.id}-tool-continuation`,
      role: 'user',
      parts: [{ type: 'text', text: TOOL_CONTINUATION_TEXT }],
    },
  ]
}

export function withoutImageParts(
  messages: UIMessage[],
  imageInputsEnabled: boolean,
): UIMessage[] {
  if (imageInputsEnabled) return messages

  return messages.flatMap((message) => {
    const parts = message.parts.filter(
      (part) => part.type !== 'file' || !part.mediaType.startsWith('image/'),
    )
    return parts.length > 0 ? [{ ...message, parts }] : []
  })
}

export function sanitizeModelNames(text: string): string {
  let out = text
  for (const model of MODELS) {
    out = out.split(model.modelId).join(model.label)
  }
  return out
}

// How many trailing messages keep their full payloads. Everything older is
// compacted: reasoning dropped, canvas snapshots dropped, tool-call code
// truncated. Without this, a few build iterations push hundreds of KB of
// stale code and PNGs into every request until the provider rejects it.
const HISTORY_TAIL_INTACT = 3
const CODE_PREVIEW_CHARS = 200

function truncatedCode(code: string): string {
  if (code.length <= CODE_PREVIEW_CHARS + 80) return code
  return `${code.slice(0, CODE_PREVIEW_CHARS)}…[truncated, ${code.length} chars — call readElement for the current code]`
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  const out = { ...value }
  if (typeof out.code === 'string') out.code = truncatedCode(out.code)
  if (typeof out.image === 'string') delete out.image
  // Edit echoes and frame logs describe code that has since moved on.
  if (Array.isArray(out.applied)) delete out.applied
  if (Array.isArray(out.logs)) delete out.logs
  if (Array.isArray(out.edits)) {
    out.edits = out.edits.map((edit) => {
      if (!edit || typeof edit !== 'object') return edit
      const next = { ...(edit as Record<string, unknown>) }
      if (typeof next.oldCode === 'string') next.oldCode = truncatedCode(next.oldCode)
      if (typeof next.newCode === 'string') next.newCode = truncatedCode(next.newCode)
      return next
    })
  }
  if (Array.isArray(out.elements)) {
    out.elements = out.elements.map((element) =>
      element && typeof element === 'object'
        ? compactRecord(element as Record<string, unknown>)
        : element,
    )
  }
  return out
}

function compactOldToolPart(part: UIMessage['parts'][number]): UIMessage['parts'][number] {
  const value = part as unknown as {
    input?: unknown
    output?: unknown
    state?: string
  }
  const next = { ...(part as Record<string, unknown>) }
  if (value.input && typeof value.input === 'object') {
    next.input = compactRecord(value.input as Record<string, unknown>)
  }
  if (value.state === 'output-available' && value.output && typeof value.output === 'object') {
    next.output =
      part.type === 'tool-viewCanvas' || part.type === 'tool-viewElement'
        ? { viewed: true }
        : compactRecord(value.output as Record<string, unknown>)
  }
  return next as unknown as UIMessage['parts'][number]
}

export const repositoryToolNames = [
  'listRepositoryTree',
  'listGitHubRepositories',
  'searchRepositoryCode',
  'readRepositoryFile',
  'viewRepositoryImage',
] as const

const repositoryToolTypes = new Set(repositoryToolNames.map((name) => `tool-${name}`))

function compactRepositoryToolPart(
  part: UIMessage['parts'][number],
): UIMessage['parts'][number] {
  const next = { ...(part as Record<string, unknown>) }
  const output = next.output
  if (output && typeof output === 'object') {
    const value = output as Record<string, unknown>
    next.output = {
      repository: value.repository,
      commitSha: value.commitSha,
      path: value.path,
      total: value.total,
      read: true,
      redacted: value.redacted,
      error: value.error,
    }
  }
  return next as unknown as UIMessage['parts'][number]
}

export function messagesForModel(
  messages: UIMessage[],
  imageInputsEnabled: boolean,
): UIMessage[] {
  const kept = withoutImageParts(messages, imageInputsEnabled)
  return kept.flatMap((message, index) => {
    const old = index < kept.length - HISTORY_TAIL_INTACT
    const parts = message.parts.flatMap((part) => {
      if (part.type === 'tool-loadSkill' || part.type === 'step-start') return []
      if (repositoryToolTypes.has(part.type)) return [compactRepositoryToolPart(part)]
      if (old && part.type === 'file') return []
      if (part.type === 'text' || part.type === 'reasoning') {
        if (!('text' in part) || typeof part.text !== 'string' || part.text.trim().length === 0) {
          return []
        }
        if (old && part.type === 'reasoning') return []
        return [part]
      }
      if (old && part.type.startsWith('tool-')) return [compactOldToolPart(part)]
      return [part]
    })
    return parts.length > 0 ? [{ ...message, parts }] : []
  })
}

export function boundedJson(value: unknown, maxChars = 40_000) {
  const json = JSON.stringify(value)
  return json.length <= maxChars ? json : `${json.slice(0, maxChars)}…[truncated]`
}

export function canvasForPrompt(shapes: CanvasElement[]) {
  return shapes.map((element) => ({
    id: element.id,
    name: element.name,
    ...(element.groupId ? { groupId: element.groupId } : {}),
    x: element.x,
    y: element.y,
    w: element.w,
    h: element.h,
    ...(element.r ? { r: element.r } : {}),
    // Surfaced so the model knows why an element is missing from the snapshot
    // (hidden) or why an edit will be refused (locked).
    ...(element.hidden ? { hidden: true } : {}),
    ...(element.locked ? { locked: true } : {}),
    code:
      element.code.length <= 1200
        ? element.code
        : `${element.code.slice(0, 400)}…[truncated — ${element.code.length} chars total; call readElement("${element.id}") before editing]`,
  }))
}
