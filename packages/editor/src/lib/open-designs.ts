import { useSyncExternalStore } from 'react'

export interface OpenDesign {
  id: string
  name: string
}

const STORAGE_KEY = 'loora:open-designs'

function readStored(): OpenDesign[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is OpenDesign =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as OpenDesign).id === 'string' &&
        typeof (entry as OpenDesign).name === 'string',
    )
  } catch {
    return []
  }
}

let tabs: OpenDesign[] = readStored()
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function commit(next: OpenDesign[]) {
  tabs = next
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Private mode or a full quota: the bar still works for this session.
  }
  emit()
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return
    tabs = readStored()
    emit()
  })
}

export function getOpenDesigns(): OpenDesign[] {
  return tabs
}

export function subscribeOpenDesigns(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useOpenDesigns(): OpenDesign[] {
  return useSyncExternalStore(subscribeOpenDesigns, getOpenDesigns)
}

/** Adds a design to the open set, or refreshes its stored name. */
export function rememberOpenDesign(id: string, name: string) {
  const trimmed = name.trim() || 'Untitled'
  const existing = tabs.find((tab) => tab.id === id)
  if (existing) {
    if (existing.name !== trimmed) {
      commit(tabs.map((tab) => (tab.id === id ? { ...tab, name: trimmed } : tab)))
    }
    return
  }
  commit([...tabs, { id, name: trimmed }])
}

export function forgetOpenDesign(id: string) {
  if (!tabs.some((tab) => tab.id === id)) return
  commit(tabs.filter((tab) => tab.id !== id))
}
