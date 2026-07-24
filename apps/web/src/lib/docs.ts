import type { CanvasElement } from './canvas'
import { onlyCodeElements } from './canvas'
import type { CanvasTarget } from '@loora/db/drafts'

export interface DocMeta {
  id: string
  name: string
}

const INDEX_KEY = 'loora:docs'
const ACTIVE_KEY = 'loora:active-doc'
const docKey = (id: string) => `loora:doc:${id}`
const draftKey = (designId: string, draftId: string) => `loora:doc:${designId}:draft:${draftId}`

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

export function deleteTargetStorage(target: CanvasTarget) {
  localStorage.removeItem(
    target.draftId ? draftKey(target.designId, target.draftId) : docKey(target.designId),
  )
}

export function saveDocs(docs: DocMeta[], activeId: string) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(docs))
  localStorage.setItem(ACTIVE_KEY, activeId)
}

export function deleteDocStorage(id: string) {
  localStorage.removeItem(docKey(id))
  const draftPrefix = `${docKey(id)}:draft:`
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index)
    if (key?.startsWith(draftPrefix)) localStorage.removeItem(key)
  }
}
