import type { CanvasElement, CanvasPage } from './canvas'
import { onlyCodeElements } from './canvas'
import { onlyCanvasPages } from './pages'
import type { CanvasTarget } from '@loora/db/drafts'

export interface DocMeta {
  id: string
  name: string
}

const INDEX_KEY = 'loora:docs'
const ACTIVE_KEY = 'loora:active-doc'
const ACTIVE_DRAFT_KEY = 'loora:active-drafts'
const docKey = (id: string) => `loora:doc:${id}`
const draftKey = (designId: string, draftId: string) => `loora:doc:${designId}:draft:${draftId}`
const pagesKey = (id: string) => `loora:pages:${id}`
const draftPagesKey = (designId: string, draftId: string) =>
  `loora:pages:${designId}:draft:${draftId}`

export function docId() {
  return `d${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function loadDocs(): { docs: DocMeta[]; activeId: string } {
  let docs = readJson<DocMeta[]>(INDEX_KEY, [])
  if (docs.length === 0) {
    const first: DocMeta = { id: docId(), name: 'Untitled' }
    docs = [first]
    localStorage.setItem(docKey(first.id), '[]')
    localStorage.setItem(INDEX_KEY, JSON.stringify(docs))
    localStorage.setItem(ACTIVE_KEY, first.id)
  }
  const stored = localStorage.getItem(ACTIVE_KEY)
  const activeId = docs.some((d) => d.id === stored) ? stored! : docs[0].id
  return { docs, activeId }
}

export function loadElements(id: string): CanvasElement[] {
  // Pre-code-element records (the old typed-shape format) are dropped on load.
  return onlyCodeElements(readJson<unknown>(docKey(id), []))
}

export function hasStoredElements(id: string) {
  return localStorage.getItem(docKey(id)) !== null
}

export function saveElements(id: string, elements: CanvasElement[]) {
  localStorage.setItem(docKey(id), JSON.stringify(elements))
}

export function loadPages(id: string): CanvasPage[] {
  return onlyCanvasPages(readJson<unknown>(pagesKey(id), []))
}

export function savePages(id: string, pages: CanvasPage[]) {
  localStorage.setItem(pagesKey(id), JSON.stringify(pages))
}

export function targetKey(target: CanvasTarget) {
  return target.draftId ? `${target.designId}:draft:${target.draftId}` : `${target.designId}:main`
}

export function loadTargetElements(target: CanvasTarget): CanvasElement[] {
  return target.draftId
    ? onlyCodeElements(readJson<unknown>(draftKey(target.designId, target.draftId), []))
    : loadElements(target.designId)
}

export function hasStoredTargetElements(target: CanvasTarget) {
  return localStorage.getItem(
    target.draftId ? draftKey(target.designId, target.draftId) : docKey(target.designId),
  ) !== null
}

export function saveTargetElements(target: CanvasTarget, elements: CanvasElement[]) {
  localStorage.setItem(
    target.draftId ? draftKey(target.designId, target.draftId) : docKey(target.designId),
    JSON.stringify(elements),
  )
}

export function loadTargetPages(target: CanvasTarget): CanvasPage[] {
  return target.draftId
    ? onlyCanvasPages(readJson<unknown>(draftPagesKey(target.designId, target.draftId), []))
    : loadPages(target.designId)
}

export function saveTargetPages(target: CanvasTarget, pages: CanvasPage[]) {
  localStorage.setItem(
    target.draftId
      ? draftPagesKey(target.designId, target.draftId)
      : pagesKey(target.designId),
    JSON.stringify(pages),
  )
}

export function deleteTargetStorage(target: CanvasTarget) {
  localStorage.removeItem(
    target.draftId ? draftKey(target.designId, target.draftId) : docKey(target.designId),
  )
  localStorage.removeItem(
    target.draftId
      ? draftPagesKey(target.designId, target.draftId)
      : pagesKey(target.designId),
  )
}

export function saveDocs(docs: DocMeta[], activeId: string) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(docs))
  localStorage.setItem(ACTIVE_KEY, activeId)
}

// Which branch each design was last edited on. Kept per design so reopening a
// design lands where the work was left, not on Main. Callers re-validate the id
// against the live branch list — a merged or discarded branch is read-only and
// must not be restored.
export function loadActiveDraft(designId: string): string | null {
  return readJson<Record<string, string>>(ACTIVE_DRAFT_KEY, {})[designId] ?? null
}

export function saveActiveDraft(designId: string, draftId: string | null) {
  const map = readJson<Record<string, string>>(ACTIVE_DRAFT_KEY, {})
  if (draftId) map[designId] = draftId
  else delete map[designId]
  localStorage.setItem(ACTIVE_DRAFT_KEY, JSON.stringify(map))
}

export function deleteDocStorage(id: string) {
  saveActiveDraft(id, null)
  localStorage.removeItem(docKey(id))
  localStorage.removeItem(pagesKey(id))
  const draftPrefix = `${docKey(id)}:draft:`
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index)
    if (key?.startsWith(draftPrefix)) localStorage.removeItem(key)
    if (key?.startsWith(`loora:pages:${id}:draft:`)) localStorage.removeItem(key)
  }
}
