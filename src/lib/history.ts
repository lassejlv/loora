import type { CanvasElement } from './canvas'

export interface Commit {
  id: string
  message: string
  at: number
  shapes: CanvasElement[]
  // diff vs the previous commit, computed at commit time
  added: number
  removed: number
  changed: number
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

function diff(prev: CanvasElement[], next: CanvasElement[]) {
  const prevById = new Map(prev.map((s) => [s.id, s]))
  const nextIds = new Set(next.map((s) => s.id))
  let added = 0
  let changed = 0
  for (const s of next) {
    const old = prevById.get(s.id)
    if (!old) added += 1
    else if (JSON.stringify(old) !== JSON.stringify(s)) changed += 1
  }
  const removed = prev.filter((s) => !nextIds.has(s.id)).length
  return { added, removed, changed }
}

export function commitDoc(docId: string, message: string, shapes: CanvasElement[]): Commit[] {
  const history = loadHistory(docId)
  const parent = history[0]?.shapes ?? []
  const commit: Commit = {
    id: `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`,
    message,
    at: Date.now(),
    shapes,
    ...diff(parent, shapes),
  }
  const next = [commit, ...history].slice(0, MAX_COMMITS)
  localStorage.setItem(key(docId), JSON.stringify(next))
  return next
}

// Auto-checkpoint: skip when the canvas is empty or identical to the latest commit.
export function commitIfChanged(docId: string, message: string, shapes: CanvasElement[]) {
  if (shapes.length === 0) return
  const latest = loadHistory(docId)[0]
  if (latest && JSON.stringify(latest.shapes) === JSON.stringify(shapes)) return
  commitDoc(docId, message, shapes)
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
