import type { CanvasElement } from '#/lib/canvas'

/**
 * Element-level diff model for the history and branch-review dialogs.
 *
 * Diffing the serialized canvas as one JSON document is technically correct and
 * unreadable: every element's code arrives as a single escaped line, so a
 * one-word copy change looks identical to a rewrite. Splitting per element lets
 * each one render as its own source diff, and lets pure geometry moves render
 * as a sentence instead of a numeric hunk nobody can parse.
 */

export type ElementChangeKind = 'added' | 'removed' | 'changed'

export interface ElementChange {
  id: string
  kind: ElementChangeKind
  name: string
  oldCode: string
  newCode: string
  /** False for geometry-only edits — those have no source hunk worth rendering. */
  codeChanged: boolean
  /** Human-readable geometry/name/grouping delta, or null when nothing moved. */
  geometry: string | null
  lang: 'tsx' | 'html'
}

export interface CanvasDiff {
  changes: ElementChange[]
  added: number
  removed: number
  changed: number
  /** Z-order of the surviving elements differs, which no per-element hunk shows. */
  orderChanged: boolean
}

// Deliberately not element-frame's classifyCode: this module stays free of the
// compiler bundle so the diff can lazy-load on its own.
export function guessLang(code: string): 'tsx' | 'html' {
  const trimmed = code.trim()
  if (/\b(function|const|let|var|class)\s+App\b/.test(trimmed)) return 'tsx'
  if (!trimmed.startsWith('<')) return 'tsx'
  if (/^<!doctype/i.test(trimmed)) return 'html'
  return /className=|<\/?[A-Z]|=\{/.test(trimmed) ? 'tsx' : 'html'
}

const round = (n: number) => Math.round(n)
const signed = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(round(n))}px`

function geometrySummary(prev: CanvasElement, next: CanvasElement): string | null {
  const parts: string[] = []
  if (prev.name !== next.name) parts.push(`renamed “${prev.name}” → “${next.name}”`)
  const dx = next.x - prev.x
  const dy = next.y - prev.y
  if (round(dx) !== 0 || round(dy) !== 0) parts.push(`moved x ${signed(dx)}, y ${signed(dy)}`)
  if (round(next.w - prev.w) !== 0 || round(next.h - prev.h) !== 0) {
    parts.push(`resized ${round(prev.w)}×${round(prev.h)} → ${round(next.w)}×${round(next.h)}`)
  }
  const prevRotation = round(prev.r ?? 0)
  const nextRotation = round(next.r ?? 0)
  if (prevRotation !== nextRotation) parts.push(`rotated ${prevRotation}° → ${nextRotation}°`)
  if ((prev.groupId ?? null) !== (next.groupId ?? null)) {
    parts.push(next.groupId ? 'grouped' : 'ungrouped')
  }
  if (parts.length === 0) return null
  return parts.join(' · ').replace(/^./, (character) => character.toUpperCase())
}

export function diffCanvas(prev: CanvasElement[], next: CanvasElement[]): CanvasDiff {
  const prevById = new Map(prev.map((element) => [element.id, element]))
  const nextIds = new Set(next.map((element) => element.id))
  const changes: ElementChange[] = []
  let added = 0
  let changed = 0

  for (const element of next) {
    const old = prevById.get(element.id)
    if (!old) {
      added += 1
      changes.push({
        id: element.id,
        kind: 'added',
        name: element.name,
        oldCode: '',
        newCode: element.code,
        codeChanged: true,
        geometry: null,
        lang: guessLang(element.code),
      })
      continue
    }
    const codeChanged = old.code !== element.code
    const geometry = geometrySummary(old, element)
    if (!codeChanged && !geometry) continue
    changed += 1
    changes.push({
      id: element.id,
      kind: 'changed',
      name: element.name,
      oldCode: old.code,
      newCode: element.code,
      codeChanged,
      geometry,
      lang: guessLang(element.code),
    })
  }

  // Removals trail the surviving elements: they have no slot left in the new order.
  const removedElements = prev.filter((element) => !nextIds.has(element.id))
  for (const element of removedElements) {
    changes.push({
      id: element.id,
      kind: 'removed',
      name: element.name,
      oldCode: element.code,
      newCode: '',
      codeChanged: true,
      geometry: null,
      lang: guessLang(element.code),
    })
  }

  const survivingBefore = prev.filter((element) => nextIds.has(element.id)).map((e) => e.id)
  const survivingAfter = next.filter((element) => prevById.has(element.id)).map((e) => e.id)
  const orderChanged = survivingBefore.join(',') !== survivingAfter.join(',')

  return { changes, added, removed: removedElements.length, changed, orderChanged }
}
