import type { CanvasElement, CanvasPage } from '@loora/db/canvas'

export interface Commit {
  id: string
  message: string
  at: number
  shapes: CanvasElement[]
  pages?: CanvasPage[]
  // diff vs the previous commit, computed at commit time
  added: number
  removed: number
  changed: number
}

export type CommitSummary = Omit<Commit, 'shapes' | 'pages'>

export interface StoredHistorySummary {
  id: string
  message: string
  added: number
  removed: number
  changed: number
  createdAt: Date
}

export function compareHistoryKeys(
  left: { at: number; id: string },
  right: { at: number; id: string },
) {
  if (left.at !== right.at) return left.at - right.at
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

export function sortCommitsOldestFirst<T extends { at: number; id: string }>(commits: T[]): T[] {
  return [...commits].sort(compareHistoryKeys)
}

export function toHistoryPage(rows: StoredHistorySummary[], limit: number) {
  const items: CommitSummary[] = rows.slice(0, limit).map((row) => ({
    id: row.id,
    message: row.message,
    added: row.added,
    removed: row.removed,
    changed: row.changed,
    at: row.createdAt.getTime(),
  }))
  const last = items.at(-1)
  return {
    items,
    nextCursor: rows.length > limit && last ? { at: last.at, id: last.id } : null,
  }
}

const key = (docId: string) => `loora:history:${docId}`
const MAX_COMMITS = 50

export function loadHistory(docId: string): Commit[] {
  try {
    return JSON.parse(localStorage.getItem(key(docId)) ?? '[]')
  } catch {
    return []
  }
}

function diff<T extends { id: string }>(prev: T[], next: T[]) {
  const prevById = new Map(prev.map((item) => [item.id, item]))
  const nextIds = new Set(next.map((item) => item.id))
  let added = 0
  let changed = 0
  for (const item of next) {
    const old = prevById.get(item.id)
    if (!old) added += 1
    else if (JSON.stringify(old) !== JSON.stringify(item)) changed += 1
  }
  const removed = prev.filter((item) => !nextIds.has(item.id)).length
  return { added, removed, changed }
}

export function commitDoc(
  docId: string,
  message: string,
  shapes: CanvasElement[],
  pages: CanvasPage[] = [],
): Commit[] {
  const history = loadHistory(docId)
  const parent = history[0]?.shapes ?? []
  const parentPages = history[0]?.pages ?? []
  const shapeChanges = diff(parent, shapes)
  const pageChanges = diff(parentPages, pages)
  const commit: Commit = {
    id: `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`,
    message,
    at: Date.now(),
    shapes,
    pages,
    added: shapeChanges.added + pageChanges.added,
    removed: shapeChanges.removed + pageChanges.removed,
    changed: shapeChanges.changed + pageChanges.changed,
  }
  const next = [commit, ...history].slice(0, MAX_COMMITS)
  localStorage.setItem(key(docId), JSON.stringify(next))
  return next
}

// Auto-checkpoint: skip when the canvas is empty or identical to the latest commit.
export function commitIfChanged(
  docId: string,
  message: string,
  shapes: CanvasElement[],
  pages: CanvasPage[] = [],
) {
  if (shapes.length === 0 && pages.length === 0) return
  const latest = loadHistory(docId)[0]
  if (
    latest &&
    JSON.stringify(latest.shapes) === JSON.stringify(shapes) &&
    JSON.stringify(latest.pages ?? []) === JSON.stringify(pages)
  ) return
  commitDoc(docId, message, shapes, pages)
}

export function deleteHistory(docId: string) {
  localStorage.removeItem(key(docId))
}

export function relativeTime(at: number): string {
  const s = Math.round((Date.now() - at) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}
