/**
 * @-mention support for the agent composer. The textarea stays plain text —
 * mentions are inserted as `@Label` and tracked separately; at send time the
 * labels still present in the text are resolved into an explicit context
 * suffix (ids, asset URLs, repo names) so the model gets precise references
 * instead of guessing which "hero" the user meant.
 */

export type MentionKind = 'element' | 'asset' | 'repo'

export interface MentionItem {
  kind: MentionKind
  /** Stable reference sent to the agent: element id, asset id, or repo full name. */
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

const KIND_ORDER: MentionKind[] = ['element', 'asset', 'repo']
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
    else parts.push(`GitHub repository ${item.id}`)
  }
  return parts.length ? `\n\n(Mentioned: ${parts.join('; ')})` : ''
}

const MENTION_SUFFIX_RE = /\n\n\(Mentioned: ([\s\S]*)\)\s*$/

/** Splits stored/sent user text into visible body and optional machine suffix. */
export function stripMentionSuffix(text: string): { body: string; suffix: string | null } {
  const match = MENTION_SUFFIX_RE.exec(text)
  if (!match) return { body: text, suffix: null }
  return { body: text.slice(0, match.index), suffix: match[1] ?? null }
}

/**
 * Parses the inner `(Mentioned: …)` payload back into mention items. Returns
 * [] when the grammar does not match — callers should fall back to plain text.
 * Legacy `the X tool` clauses are ignored so older transcripts still strip cleanly.
 */
export function parseMentionSuffix(suffix: string): MentionItem[] {
  const items: MentionItem[] = []
  for (const raw of suffix.split(';')) {
    const part = raw.trim()
    if (!part) continue
    // Drop removed tool mentions without failing the whole suffix.
    if (/^the .+ tool$/.test(part)) continue
    let match = /^element "([^"]*)" \(id (.+)\)$/.exec(part)
    if (match) {
      items.push({ kind: 'element', label: match[1]!, id: match[2]! })
      continue
    }
    match = /^asset "([^"]*)" \(url \/api\/asset\/(.+)\)$/.exec(part)
    if (match) {
      items.push({ kind: 'asset', label: match[1]!, id: match[2]! })
      continue
    }
    match = /^GitHub repository (.+)$/.exec(part)
    if (match) {
      items.push({ kind: 'repo', label: match[1]!, id: match[1]! })
      continue
    }
    return []
  }
  return items
}

export type MentionTextSegment =
  | { type: 'text'; value: string }
  | { type: 'mention'; item: MentionItem }

/**
 * Walks the visible body and turns surviving `@Label` spans into mention
 * segments. Longer labels win so `@Hero section` is not split by `@Hero`.
 */
export function segmentMentionText(
  body: string,
  mentions: ReadonlyArray<MentionItem>,
): MentionTextSegment[] {
  if (mentions.length === 0 || !body.includes('@')) {
    return body ? [{ type: 'text', value: body }] : []
  }

  const byLabel = [...mentions]
    .filter((item) => item.label.length > 0)
    .sort((a, b) => b.label.length - a.label.length)

  const segments: MentionTextSegment[] = []
  let cursor = 0
  while (cursor < body.length) {
    const at = body.indexOf('@', cursor)
    if (at < 0) {
      segments.push({ type: 'text', value: body.slice(cursor) })
      break
    }
    if (at > cursor) segments.push({ type: 'text', value: body.slice(cursor, at) })

    let matched: MentionItem | null = null
    for (const item of byLabel) {
      const token = `@${item.label}`
      if (body.startsWith(token, at)) {
        matched = item
        segments.push({ type: 'mention', item })
        cursor = at + token.length
        break
      }
    }
    if (!matched) {
      segments.push({ type: 'text', value: '@' })
      cursor = at + 1
    }
  }

  return mergeAdjacentText(segments)
}

function mergeAdjacentText(segments: MentionTextSegment[]): MentionTextSegment[] {
  const merged: MentionTextSegment[] = []
  for (const segment of segments) {
    const last = merged[merged.length - 1]
    if (segment.type === 'text' && last?.type === 'text') {
      last.value += segment.value
    } else {
      merged.push(segment.type === 'text' ? { ...segment } : segment)
    }
  }
  return merged
}

/** Builds the full mention catalog from live canvas + remote asset/repo lists. */
export function composerMentionItems(sources: {
  elements: ReadonlyArray<{ id: string; name: string; w: number; h: number }>
  assets: ReadonlyArray<{ id: string; name: string }>
  repos: ReadonlyArray<{ fullName: string }>
  /** Canvas selection — floated to the top of the element group. */
  selectedIds?: ReadonlyArray<string>
  /** Design-bound GitHub repo — floated to the top of the repo group. */
  preferredRepo?: string | null
}): MentionItem[] {
  const selected = new Set(sources.selectedIds ?? [])
  const preferred = sources.preferredRepo?.trim().toLowerCase() || null
  const elements = [...sources.elements].sort((a, b) => {
    const aSel = selected.has(a.id) ? 0 : 1
    const bSel = selected.has(b.id) ? 0 : 1
    return aSel - bSel
  })
  const repos = [...sources.repos].sort((a, b) => {
    if (!preferred) return 0
    const aPref = a.fullName.toLowerCase() === preferred ? 0 : 1
    const bPref = b.fullName.toLowerCase() === preferred ? 0 : 1
    return aPref - bPref
  })

  return [
    ...elements.map((element) => ({
      kind: 'element' as const,
      id: element.id,
      label: element.name,
      hint: selected.has(element.id)
        ? `Selected · ${element.w}×${element.h}`
        : `${element.w}×${element.h}`,
    })),
    ...sources.assets.map((asset) => ({
      kind: 'asset' as const,
      id: asset.id,
      label: asset.name,
    })),
    ...repos.map((repo) => ({
      kind: 'repo' as const,
      id: repo.fullName,
      label: repo.fullName,
      hint: preferred && repo.fullName.toLowerCase() === preferred ? 'Linked' : undefined,
    })),
  ]
}
