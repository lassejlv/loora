import type { CanvasElement } from './canvas'
import { onlyCodeElements } from './canvas'

export type DocMode = 'canvas' | 'page'

export interface DocMeta {
  id: string
  name: string
  // How the document is viewed: freeform canvas (default) or a Claude-Design
  // style web page view where each top-level element is one page.
  mode?: DocMode
}

const INDEX_KEY = 'loora:docs'
const ACTIVE_KEY = 'loora:active-doc'
const docKey = (id: string) => `loora:doc:${id}`

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

export function saveElements(id: string, elements: CanvasElement[]) {
  localStorage.setItem(docKey(id), JSON.stringify(elements))
}

export function saveDocs(docs: DocMeta[], activeId: string) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(docs))
  localStorage.setItem(ACTIVE_KEY, activeId)
}

export function deleteDocStorage(id: string) {
  localStorage.removeItem(docKey(id))
}
