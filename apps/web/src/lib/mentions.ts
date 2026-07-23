/**
 * @-mention support for the agent composer. The textarea stays plain text —
 * mentions are inserted as `@Label` and tracked separately; at send time the
 * labels still present in the text are resolved into an explicit context
 * suffix (ids, asset URLs, repo names) so the model gets precise references
 * instead of guessing which "hero" the user meant.
 */

export type MentionKind = 'element' | 'asset' | 'tool' | 'repo'

export interface MentionItem {
  kind: MentionKind
  /** Stable reference sent to the agent: element id, asset id, tool name, repo full name. */
  id: string
  /** Text inserted into the composer after the @. */
  label: string
  hint?: string
}

const MAX_QUERY_LENGTH = 40

/**
 * The `@query` the caret is currently inside, or null. An @ only triggers at
 * the start of the text or after whitespace, and the query never spans lines
 * or a second @.
 */
export function activeMentionQuery(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  for (let i = caret - 1; i >= 0 && caret - i <= MAX_QUERY_LENGTH + 1; i--) {
    const ch = text[i]
    if (ch === '\n') return null
    if (ch === '@') {
      if (i > 0 && !/\s/.test(text[i - 1]!)) return null
      return { start: i, query: text.slice(i + 1, caret) }
    }
  }
  return null
}

const KIND_ORDER: MentionKind[] = ['element', 'asset', 'tool', 'repo']
const PER_KIND_LIMIT = 5

/** Case-insensitive substring filter, grouped in a stable kind order. */
export function filterMentionItems(items: MentionItem[], query: string): MentionItem[] {
  const q = query.trim().toLowerCase()
  const matches = q
    ? items.filter(
        (item) => item.label.toLowerCase().includes(q) || item.id.toLowerCase().includes(q),
      )
    : items
  const result: MentionItem[] = []
  for (const kind of KIND_ORDER) {
    result.push(...matches.filter((item) => item.kind === kind).slice(0, PER_KIND_LIMIT))
  }
  return result
}

/** Replaces the active `@query` with `@Label ` and returns the caret position after it. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  label: string,
): { text: string; caret: number } {
  const inserted = `@${label} `
  return {
    text: text.slice(0, start) + inserted + text.slice(caret),
    caret: start + inserted.length,
  }
}

/**
 * Context lines for mentions whose `@Label` survived editing. Appended to the
 * outgoing message the same way canvas comments fold their location in.
 */
export function mentionSuffix(text: string, tracked: MentionItem[]): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const item of tracked) {
    const key = `${item.kind}:${item.id}`
    if (seen.has(key) || !text.includes(`@${item.label}`)) continue
    seen.add(key)
    if (item.kind === 'element') parts.push(`element "${item.label}" (id ${item.id})`)
    else if (item.kind === 'asset') parts.push(`asset "${item.label}" (url /api/asset/${item.id})`)
    else if (item.kind === 'tool') parts.push(`the ${item.id} tool`)
    else parts.push(`GitHub repository ${item.id}`)
  }
  return parts.length ? `\n\n(Mentioned: ${parts.join('; ')})` : ''
}

/** Builds the full mention catalog from live canvas + remote asset/repo lists. */
export function composerMentionItems(sources: {
  elements: ReadonlyArray<{ id: string; name: string; w: number; h: number }>
  assets: ReadonlyArray<{ id: string; name: string }>
  tools: ReadonlyArray<{ id: string; hint?: string }>
  repos: ReadonlyArray<{ fullName: string }>
}): MentionItem[] {
  return [
    ...sources.elements.map((element) => ({
      kind: 'element' as const,
      id: element.id,
      label: element.name,
      hint: `${element.w}×${element.h}`,
    })),
    ...sources.assets.map((asset) => ({
      kind: 'asset' as const,
      id: asset.id,
      label: asset.name,
    })),
    ...sources.tools.map((tool) => ({
      kind: 'tool' as const,
      id: tool.id,
      label: tool.id,
      hint: tool.hint,
    })),
    ...sources.repos.map((repo) => ({
      kind: 'repo' as const,
      id: repo.fullName,
      label: repo.fullName,
    })),
  ]
}
