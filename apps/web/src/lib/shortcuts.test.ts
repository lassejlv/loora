import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_SHORTCUTS,
  detectConflicts,
  eventToChord,
  formatChord,
  matchChord,
  matchShortcut,
  normalizeConfig,
  resolveBuiltIn,
  serializeChord,
  type ShortcutConfig,
} from '#/lib/shortcuts'

function keyEvent(init: {
  key: string
  code?: string
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key: init.key,
    code: init.code ?? `Key${init.key.toUpperCase()}`,
    metaKey: init.metaKey,
    ctrlKey: init.ctrlKey,
    shiftKey: init.shiftKey,
    altKey: init.altKey,
    bubbles: true,
  })
}

describe('matchChord', () => {
  test('matches meta-or-ctrl for meta chords', () => {
    const chord = { key: 'z', meta: true }
    expect(matchChord(keyEvent({ key: 'z', metaKey: true }), chord)).toBe(true)
    expect(matchChord(keyEvent({ key: 'z', ctrlKey: true }), chord)).toBe(true)
    expect(matchChord(keyEvent({ key: 'z' }), chord)).toBe(false)
  })

  test('requires shift when specified', () => {
    const chord = { key: 'z', meta: true, shift: true }
    expect(matchChord(keyEvent({ key: 'z', metaKey: true, shiftKey: true }), chord)).toBe(true)
    expect(matchChord(keyEvent({ key: 'z', metaKey: true }), chord)).toBe(false)
  })

  test('uses code when present', () => {
    const chord = { key: '1', code: 'Digit1', shift: true }
    expect(
      matchChord(keyEvent({ key: '!', code: 'Digit1', shiftKey: true }), chord),
    ).toBe(true)
    expect(
      matchChord(keyEvent({ key: '1', code: 'Digit1' }), chord),
    ).toBe(false)
  })
})

describe('resolveBuiltIn / matchShortcut', () => {
  test('uses defaults when no overrides', () => {
    const config: ShortcutConfig = { overrides: {}, custom: [] }
    expect(resolveBuiltIn('undo', config)).toEqual([{ key: 'z', meta: true }])
    const hit = matchShortcut(keyEvent({ key: 'z', metaKey: true }), config)
    expect(hit).toEqual({ kind: 'builtIn', id: 'undo' })
    expect(
      matchShortcut(keyEvent({ key: 'k', metaKey: true }), config),
    ).toEqual({ kind: 'builtIn', id: 'openCommandMenu' })
  })

  test('honors null unbind and remaps', () => {
    const config: ShortcutConfig = {
      overrides: {
        undo: null,
        'tool.select': { key: 'q' },
      },
      custom: [],
    }
    expect(resolveBuiltIn('undo', config)).toBeNull()
    expect(matchShortcut(keyEvent({ key: 'z', metaKey: true }), config)).toBeNull()
    expect(matchShortcut(keyEvent({ key: 'q' }), config)).toEqual({
      kind: 'builtIn',
      id: 'tool.select',
    })
  })

  test('matches custom agent prompts', () => {
    const config: ShortcutConfig = {
      overrides: {},
      custom: [
        {
          id: 'c1',
          name: 'Polish',
          chord: { key: 'p', meta: true, shift: true },
          action: { type: 'agentPrompt', prompt: 'Polish the selection' },
        },
      ],
    }
    expect(
      matchShortcut(keyEvent({ key: 'p', metaKey: true, shiftKey: true }), config),
    ).toEqual({
      kind: 'custom',
      id: 'c1',
      prompt: 'Polish the selection',
      name: 'Polish',
    })
  })
})

describe('detectConflicts', () => {
  test('flags overlapping chords', () => {
    const config: ShortcutConfig = {
      overrides: {
        'tool.select': { key: 'c', meta: true },
      },
      custom: [],
    }
    const conflicts = detectConflicts(config)
    expect(conflicts.some((c) => c.owners.includes('Copy') && c.owners.includes('Select tool'))).toBe(
      true,
    )
  })
})

describe('format / serialize / eventToChord', () => {
  test('serializes stably', () => {
    expect(serializeChord({ key: 'z', meta: true, shift: true })).toBe('meta+shift+key:z')
  })

  test('formats chords', () => {
    const label = formatChord(DEFAULT_SHORTCUTS.group)
    expect(label.includes('G')).toBe(true)
  })

  test('eventToChord captures digit codes', () => {
    const chord = eventToChord(
      keyEvent({ key: '!', code: 'Digit1', shiftKey: true }),
    )
    expect(chord).toEqual({ key: '1', code: 'Digit1', shift: true })
  })

  test('normalizeConfig fills gaps', () => {
    expect(normalizeConfig(null)).toEqual({ overrides: {}, custom: [] })
    expect(normalizeConfig({ overrides: { undo: null } }).overrides.undo).toBeNull()
  })
})
