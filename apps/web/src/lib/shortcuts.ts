import type {
  BuiltInShortcutId,
  KeyChord,
  ShortcutConfig,
} from '@loora/db/shortcuts'
import { EMPTY_SHORTCUT_CONFIG } from '@loora/db/shortcuts'

export type { BuiltInShortcutId, KeyChord, ShortcutConfig }
export { EMPTY_SHORTCUT_CONFIG }

export const SHORTCUT_STORAGE_KEY = 'loora:shortcuts'

export type ShortcutGroupId = 'tools' | 'edit' | 'view' | 'arrange' | 'panels'

export const BUILTIN_META: Record<
  BuiltInShortcutId,
  { label: string; group: ShortcutGroupId }
> = {
  'tool.select': { label: 'Select tool', group: 'tools' },
  'tool.interact': { label: 'Interact tool', group: 'tools' },
  'tool.comment': { label: 'Comment tool', group: 'tools' },
  'tool.text': { label: 'Text tool', group: 'tools' },
  'tool.box': { label: 'Box tool', group: 'tools' },
  'tool.image': { label: 'Image tool', group: 'tools' },
  'tool.hand': { label: 'Hand tool', group: 'tools' },
  undo: { label: 'Undo', group: 'edit' },
  redo: { label: 'Redo', group: 'edit' },
  cut: { label: 'Cut', group: 'edit' },
  copy: { label: 'Copy', group: 'edit' },
  paste: { label: 'Paste', group: 'edit' },
  duplicate: { label: 'Duplicate', group: 'edit' },
  delete: { label: 'Delete', group: 'edit' },
  selectAll: { label: 'Select all', group: 'edit' },
  escape: { label: 'Deselect / select tool', group: 'edit' },
  group: { label: 'Group', group: 'edit' },
  ungroup: { label: 'Ungroup', group: 'edit' },
  zoomIn: { label: 'Zoom in', group: 'view' },
  zoomOut: { label: 'Zoom out', group: 'view' },
  zoomReset: { label: 'Zoom reset', group: 'view' },
  zoomToFit: { label: 'Zoom to fit', group: 'view' },
  zoomToSelection: { label: 'Zoom to selection', group: 'view' },
  bringForward: { label: 'Bring forward', group: 'arrange' },
  bringToFront: { label: 'Bring to front', group: 'arrange' },
  sendBackward: { label: 'Send backward', group: 'arrange' },
  sendToBack: { label: 'Send to back', group: 'arrange' },
  nudgeLeft: { label: 'Nudge left', group: 'arrange' },
  nudgeRight: { label: 'Nudge right', group: 'arrange' },
  nudgeUp: { label: 'Nudge up', group: 'arrange' },
  nudgeDown: { label: 'Nudge down', group: 'arrange' },
  toggleLayers: { label: 'Toggle layers', group: 'panels' },
  toggleAssets: { label: 'Toggle assets', group: 'panels' },
  toggleHistory: { label: 'Toggle history', group: 'panels' },
  openCommandMenu: { label: 'Open command menu', group: 'panels' },
  openSettings: { label: 'Open settings', group: 'panels' },
}

export const SHORTCUT_GROUPS: { id: ShortcutGroupId; label: string }[] = [
  { id: 'tools', label: 'Tools' },
  { id: 'edit', label: 'Edit' },
  { id: 'view', label: 'View' },
  { id: 'arrange', label: 'Arrange' },
  { id: 'panels', label: 'Panels' },
]

const key = (k: string, mods: Partial<Omit<KeyChord, 'key' | 'code'>> = {}): KeyChord => ({
  key: k,
  ...mods,
})

const code = (
  c: string,
  k: string,
  mods: Partial<Omit<KeyChord, 'key' | 'code'>> = {},
): KeyChord => ({
  key: k,
  code: c,
  ...mods,
})

export const DEFAULT_SHORTCUTS: Record<BuiltInShortcutId, KeyChord | KeyChord[]> = {
  undo: key('z', { meta: true }),
  redo: key('z', { meta: true, shift: true }),
  group: key('g', { meta: true }),
  ungroup: key('g', { meta: true, shift: true }),
  zoomIn: [key('=', { meta: true }), key('+', { meta: true })],
  zoomOut: key('-', { meta: true }),
  zoomReset: key('0', { meta: true }),
  zoomToFit: code('Digit1', '1', { shift: true }),
  zoomToSelection: code('Digit2', '2', { shift: true }),
  selectAll: key('a', { meta: true }),
  duplicate: key('d', { meta: true }),
  copy: key('c', { meta: true }),
  paste: key('v', { meta: true }),
  cut: key('x', { meta: true }),
  bringForward: [key(']'), key('}')],
  bringToFront: [key(']', { shift: true }), key('}', { shift: true })],
  sendBackward: [key('['), key('{')],
  sendToBack: [key('[', { shift: true }), key('{', { shift: true })],
  'tool.select': key('v'),
  'tool.interact': key('i'),
  'tool.comment': key('c'),
  'tool.text': key('t'),
  'tool.box': key('r'),
  'tool.image': key('m'),
  'tool.hand': key('h'),
  delete: [key('delete'), key('backspace')],
  escape: key('escape'),
  nudgeLeft: key('arrowleft'),
  nudgeRight: key('arrowright'),
  nudgeUp: key('arrowup'),
  nudgeDown: key('arrowdown'),
  toggleLayers: key('l', { meta: true }),
  toggleAssets: key('k', { meta: true, shift: true }),
  toggleHistory: key('y', { meta: true }),
  openCommandMenu: key('k', { meta: true }),
  openSettings: key(',', { meta: true }),
}

export function normalizeConfig(input: unknown): ShortcutConfig {
  if (!input || typeof input !== 'object') return { ...EMPTY_SHORTCUT_CONFIG }
  const raw = input as Partial<ShortcutConfig>
  return {
    overrides: raw.overrides && typeof raw.overrides === 'object' ? { ...raw.overrides } : {},
    custom: Array.isArray(raw.custom) ? [...raw.custom] : [],
  }
}

export function loadCachedShortcuts(): ShortcutConfig {
  if (typeof window === 'undefined') return { ...EMPTY_SHORTCUT_CONFIG }
  try {
    const raw = window.localStorage.getItem(SHORTCUT_STORAGE_KEY)
    if (!raw) return { ...EMPTY_SHORTCUT_CONFIG }
    return normalizeConfig(JSON.parse(raw))
  } catch {
    return { ...EMPTY_SHORTCUT_CONFIG }
  }
}

export function cacheShortcuts(config: ShortcutConfig) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(config))
}

export function chordsOf(value: KeyChord | KeyChord[] | null | undefined): KeyChord[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

export function resolveBuiltIn(
  id: BuiltInShortcutId,
  config: ShortcutConfig,
): KeyChord[] | null {
  if (Object.prototype.hasOwnProperty.call(config.overrides, id)) {
    const override = config.overrides[id]
    if (override === null) return null
    return chordsOf(override)
  }
  return chordsOf(DEFAULT_SHORTCUTS[id])
}

export function serializeChord(chord: KeyChord): string {
  const parts = [
    chord.meta ? 'meta' : '',
    chord.ctrl ? 'ctrl' : '',
    chord.alt ? 'alt' : '',
    chord.shift ? 'shift' : '',
    chord.code ? `code:${chord.code}` : '',
    `key:${chord.key.toLowerCase()}`,
  ]
  return parts.filter(Boolean).join('+')
}

export function matchChord(e: KeyboardEvent, chord: KeyChord): boolean {
  const wantsMeta = Boolean(chord.meta)
  const hasMeta = e.metaKey || e.ctrlKey
  if (wantsMeta !== hasMeta) return false
  if (Boolean(chord.ctrl) && !e.ctrlKey) return false
  if (Boolean(chord.shift) !== e.shiftKey) return false
  if (Boolean(chord.alt) !== e.altKey) return false

  if (chord.code) return e.code === chord.code

  const eventKey = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase()
  return eventKey === chord.key.toLowerCase()
}

/** First matching binding wins, in registry order. */
export function matchShortcut(
  e: KeyboardEvent,
  config: ShortcutConfig,
): BuiltInShortcutId | null {
  for (const id of Object.keys(DEFAULT_SHORTCUTS) as BuiltInShortcutId[]) {
    const chords = resolveBuiltIn(id, config)
    if (!chords) continue
    if (chords.some((chord) => matchChord(e, chord))) return id
  }
  return null
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('input, textarea, [contenteditable]'))
}

export function eventToChord(e: KeyboardEvent): KeyChord | null {
  const raw = e.key
  if (raw === 'Shift' || raw === 'Control' || raw === 'Alt' || raw === 'Meta') return null
  const chord: KeyChord = {
    key: raw.length === 1 ? raw.toLowerCase() : raw.toLowerCase(),
  }
  if (e.metaKey || e.ctrlKey) chord.meta = true
  if (e.shiftKey) chord.shift = true
  if (e.altKey) chord.alt = true
  // Digits: store code so Shift+1 works across layouts.
  if (e.code.startsWith('Digit')) {
    chord.code = e.code
    chord.key = e.code.slice('Digit'.length)
  }
  return chord
}

function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
}

export function formatChord(chord: KeyChord | KeyChord[] | null | undefined): string {
  const list = chordsOf(chord)
  if (list.length === 0) return '—'
  return list.map(formatSingleChord).join(' / ')
}

export function formatBuiltInChord(id: BuiltInShortcutId, config: ShortcutConfig): string {
  return formatChord(resolveBuiltIn(id, config))
}

function formatSingleChord(chord: KeyChord): string {
  const mac = isMac()
  const parts: string[] = []
  if (chord.meta) parts.push(mac ? '⌘' : 'Ctrl')
  if (chord.ctrl && !chord.meta) parts.push('Ctrl')
  if (chord.alt) parts.push(mac ? '⌥' : 'Alt')
  if (chord.shift) parts.push(mac ? '⇧' : 'Shift')

  const label = keyLabel(chord)
  parts.push(label)
  return parts.join(mac ? '' : '+')
}

function keyLabel(chord: KeyChord): string {
  if (chord.code?.startsWith('Digit')) return chord.code.slice('Digit'.length)
  const k = chord.key.toLowerCase()
  const names: Record<string, string> = {
    escape: 'Esc',
    backspace: '⌫',
    delete: 'Del',
    arrowleft: '←',
    arrowright: '→',
    arrowup: '↑',
    arrowdown: '↓',
    enter: '↵',
    ' ': 'Space',
    space: 'Space',
    ',': ',',
    '=': '=',
    '+': '+',
    '-': '−',
    '[': '[',
    ']': ']',
    '{': '{',
    '}': '}',
  }
  if (names[k]) return names[k]
  return k.length === 1 ? k.toUpperCase() : k
}

export type ShortcutConflict = {
  serialized: string
  label: string
  owners: string[]
}

export function detectConflicts(config: ShortcutConfig): ShortcutConflict[] {
  const owners = new Map<string, string[]>()

  const add = (chord: KeyChord, owner: string) => {
    const serialized = serializeChord(chord)
    const list = owners.get(serialized) ?? []
    list.push(owner)
    owners.set(serialized, list)
  }

  for (const id of Object.keys(DEFAULT_SHORTCUTS) as BuiltInShortcutId[]) {
    const chords = resolveBuiltIn(id, config)
    if (!chords) continue
    for (const chord of chords) add(chord, BUILTIN_META[id].label)
  }

  const conflicts: ShortcutConflict[] = []
  for (const [serialized, list] of owners) {
    if (list.length < 2) continue
    conflicts.push({
      serialized,
      label: formatChord(deserializeChord(serialized)),
      owners: list,
    })
  }
  return conflicts
}

/** Best-effort reverse of serializeChord for conflict labels. */
function deserializeChord(serialized: string): KeyChord {
  const parts = serialized.split('+')
  const chord: KeyChord = { key: '' }
  for (const part of parts) {
    if (part === 'meta') chord.meta = true
    else if (part === 'ctrl') chord.ctrl = true
    else if (part === 'alt') chord.alt = true
    else if (part === 'shift') chord.shift = true
    else if (part.startsWith('code:')) chord.code = part.slice(5)
    else if (part.startsWith('key:')) chord.key = part.slice(4)
  }
  return chord
}

export function shouldPreventDefault(id: BuiltInShortcutId): boolean {
  // Match prior behavior: copy/cut don't preventDefault; most others do when modded or special.
  if (id === 'copy' || id === 'cut') return false
  if (id.startsWith('tool.')) return false
  if (id === 'delete' || id === 'escape') return false
  return true
}
