import { describe, expect, test } from 'bun:test'
import {
  activeMentionQuery,
  composerMentionItems,
  filterMentionItems,
  insertMention,
  mentionSuffix,
  type MentionItem,
} from './mentions'

describe('activeMentionQuery', () => {
  test('detects @ at the start of the text', () => {
    expect(activeMentionQuery('@he', 3)).toEqual({ start: 0, query: 'he' })
  })

  test('detects @ after whitespace with a multi-word query', () => {
    expect(activeMentionQuery('resize @Hero sec', 16)).toEqual({ start: 7, query: 'Hero sec' })
  })

  test('ignores @ glued to a word (emails)', () => {
    expect(activeMentionQuery('mail me@example', 15)).toBeNull()
  })

  test('does not span lines', () => {
    expect(activeMentionQuery('@hero\nmore', 10)).toBeNull()
  })

  test('returns null without an @', () => {
    expect(activeMentionQuery('plain text', 5)).toBeNull()
  })

  test('gives up past the max query length', () => {
    expect(activeMentionQuery(`@${'x'.repeat(60)}`, 61)).toBeNull()
  })
})

const items: MentionItem[] = [
  { kind: 'tool', id: 'viewCanvas', label: 'viewCanvas' },
  { kind: 'element', id: 'el-1', label: 'Hero section' },
  { kind: 'element', id: 'el-2', label: 'Footer' },
  { kind: 'asset', id: 'as-1', label: 'logo.png' },
  { kind: 'repo', id: 'acme/site', label: 'acme/site' },
]

describe('filterMentionItems', () => {
  test('groups results in element, asset, tool, repo order', () => {
    expect(filterMentionItems(items, '').map((i) => i.kind)).toEqual([
      'element',
      'element',
      'asset',
      'tool',
      'repo',
    ])
  })

  test('matches label substrings case-insensitively', () => {
    expect(filterMentionItems(items, 'hero')).toEqual([items[1]!])
  })

  test('matches ids too', () => {
    expect(filterMentionItems(items, 'acme')).toEqual([items[4]!])
  })
})

describe('insertMention', () => {
  test('replaces the active query and places the caret after a trailing space', () => {
    const result = insertMention('resize @her please', 7, 11, 'Hero section')
    expect(result.text).toBe('resize @Hero section  please')
    expect(result.caret).toBe(21)
  })
})

describe('mentionSuffix', () => {
  test('resolves surviving mentions into explicit references', () => {
    const suffix = mentionSuffix('resize @Hero section and use @logo.png', [
      items[1]!,
      items[3]!,
    ])
    expect(suffix).toBe(
      '\n\n(Mentioned: element "Hero section" (id el-1); asset "logo.png" (url /api/asset/as-1))',
    )
  })

  test('drops mentions deleted from the text and dedupes repeats', () => {
    expect(mentionSuffix('no mentions left', [items[1]!])).toBe('')
    const suffix = mentionSuffix('@Footer twice @Footer', [items[2]!, items[2]!])
    expect(suffix).toBe('\n\n(Mentioned: element "Footer" (id el-2))')
  })

  test('describes tools and repositories', () => {
    const suffix = mentionSuffix('run @viewCanvas on @acme/site', [items[0]!, items[4]!])
    expect(suffix).toBe('\n\n(Mentioned: the viewCanvas tool; GitHub repository acme/site)')
  })
})

describe('composerMentionItems', () => {
  test('maps each source into a typed mention row', () => {
    expect(
      composerMentionItems({
        elements: [{ id: 'el-1', name: 'Hero', w: 320, h: 180 }],
        assets: [{ id: 'as-1', name: 'logo.png' }],
        tools: [{ id: 'viewCanvas', hint: 'Verify' }],
        repos: [{ fullName: 'acme/site' }],
      }),
    ).toEqual([
      { kind: 'element', id: 'el-1', label: 'Hero', hint: '320×180' },
      { kind: 'asset', id: 'as-1', label: 'logo.png' },
      { kind: 'tool', id: 'viewCanvas', label: 'viewCanvas', hint: 'Verify' },
      { kind: 'repo', id: 'acme/site', label: 'acme/site' },
    ])
  })
})
