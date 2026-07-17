import type { Shape } from './canvas'

export interface DocMeta {
  id: string
  name: string
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

// First run migrates the single-canvas storage into document #1.
export function loadDocs(): { docs: DocMeta[]; activeId: string } {
  let docs = readJson<DocMeta[]>(INDEX_KEY, [])
  if (docs.length === 0) {
    const legacy =
      localStorage.getItem('loora:shapes') ?? localStorage.getItem('canvasx:shapes') ?? '[]'
    const first: DocMeta = { id: docId(), name: 'Untitled' }
    docs = [first]
    localStorage.setItem(docKey(first.id), legacy)
    localStorage.setItem(INDEX_KEY, JSON.stringify(docs))
    localStorage.setItem(ACTIVE_KEY, first.id)
  }
  const stored = localStorage.getItem(ACTIVE_KEY)
  const activeId = docs.some((d) => d.id === stored) ? stored! : docs[0].id
  return { docs, activeId }
}

export function loadShapes(id: string): Shape[] {
  return readJson<Shape[]>(docKey(id), [])
}

export function saveShapes(id: string, shapes: Shape[]) {
  localStorage.setItem(docKey(id), JSON.stringify(shapes))
}

export function saveDocs(docs: DocMeta[], activeId: string) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(docs))
  localStorage.setItem(ACTIVE_KEY, activeId)
}

export function deleteDocStorage(id: string) {
  localStorage.removeItem(docKey(id))
}
