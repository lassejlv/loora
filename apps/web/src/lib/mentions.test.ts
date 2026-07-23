import { describe, expect, test } from 'bun:test'
import {
  activeMentionQuery,
  composerMentionItems,
  filterMentionItems,
  insertMention,
  mentionSuffix,
  parseMentionSuffix,
  segmentMentionText,
  stripMentionSuffix,
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
  { kind: 'element', id: 'el-1', label: 'Hero section' },
  { kind: 'element', id: 'el-2', label: 'Footer' },
  { kind: 'asset', id: 'as-1', label: 'logo.png' },
  { kind: 'repo', id: 'acme/site', label: 'acme/site' },
]

describe('filterMentionItems', () => {
  test('groups results in element, asset, repo order', () => {
    expect(filterMentionItems(items, '').map((i) => i.kind)).toEqual([
      'element',
      'element',
      'asset',
      'repo',
    ])
  })

  test('matches label substrings case-insensitively', () => {
    expect(filterMentionItems(items, 'hero')).toEqual([items[0]!])
  })

  test('matches ids too', () => {
    expect(filterMentionItems(items, 'acme')).toEqual([items[3]!])
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
      items[0]!,
      items[2]!,
    ])
    expect(suffix).toBe(
      '\n\n(Mentioned: element "Hero section" (id el-1); asset "logo.png" (url /api/asset/as-1))',
    )
  })

  test('drops mentions deleted from the text and dedupes repeats', () => {
    expect(mentionSuffix('no mentions left', [items[0]!])).toBe('')
    const suffix = mentionSuffix('@Footer twice @Footer', [items[1]!, items[1]!])
    expect(suffix).toBe('\n\n(Mentioned: element "Footer" (id el-2))')
  })

  test('describes repositories', () => {
    const suffix = mentionSuffix('use @acme/site', [items[3]!])
    expect(suffix).toBe('\n\n(Mentioned: GitHub repository acme/site)')
  })
})

describe('stripMentionSuffix', () => {
  test('returns the text unchanged when there is no suffix', () => {
    expect(stripMentionSuffix('plain @Hero')).toEqual({ body: 'plain @Hero', suffix: null })
  })

  test('splits body from the trailing Mentioned payload', () => {
    const outbound =
      'resize @Hero section' +
      mentionSuffix('resize @Hero section', [items[0]!])
    expect(stripMentionSuffix(outbound)).toEqual({
      body: 'resize @Hero section',
      suffix: 'element "Hero section" (id el-1)',
    })
  })
})

describe('parseMentionSuffix', () => {
  test('round-trips every kind emitted by mentionSuffix', () => {
    const outbound = mentionSuffix('x @Hero section @logo.png @acme/site', [
      items[0]!,
      items[2]!,
      items[3]!,
    ])
    const { suffix } = stripMentionSuffix(`x${outbound}`)
    expect(parseMentionSuffix(suffix!)).toEqual([
      { kind: 'element', label: 'Hero section', id: 'el-1' },
      { kind: 'asset', label: 'logo.png', id: 'as-1' },
      { kind: 'repo', label: 'acme/site', id: 'acme/site' },
    ])
  })

  test('skips legacy tool clauses without failing the suffix', () => {
    expect(
      parseMentionSuffix(
        'element "Hero section" (id el-1); the viewCanvas tool; GitHub repository acme/site',
      ),
    ).toEqual([
      { kind: 'element', label: 'Hero section', id: 'el-1' },
      { kind: 'repo', label: 'acme/site', id: 'acme/site' },
    ])
  })

  test('returns [] when any clause is unrecognizable', () => {
    expect(parseMentionSuffix('element "Hero" (id el-1); mystery clause')).toEqual([])
  })
})

describe('segmentMentionText', () => {
  test('keeps plain text when there are no mentions', () => {
    expect(segmentMentionText('hello', [])).toEqual([{ type: 'text', value: 'hello' }])
  })

  test('chips @labels and prefers the longer overlapping label', () => {
    const hero = { kind: 'element' as const, id: 'el-1', label: 'Hero' }
    const heroSection = { kind: 'element' as const, id: 'el-2', label: 'Hero section' }
    expect(segmentMentionText('fix @Hero section please', [hero, heroSection])).toEqual([
      { type: 'text', value: 'fix ' },
      { type: 'mention', item: heroSection },
      { type: 'text', value: ' please' },
    ])
  })

  test('leaves a lone @ as text', () => {
    expect(segmentMentionText('see @unknown', [items[1]!])).toEqual([
      { type: 'text', value: 'see @unknown' },
    ])
  })
})

describe('composerMentionItems', () => {
  test('maps each source into a typed mention row', () => {
    expect(
      composerMentionItems({
        elements: [{ id: 'el-1', name: 'Hero', w: 320, h: 180 }],
        assets: [{ id: 'as-1', name: 'logo.png' }],
        repos: [{ fullName: 'acme/site' }],
      }),
    ).toEqual([
      { kind: 'element', id: 'el-1', label: 'Hero', hint: '320×180' },
      { kind: 'asset', id: 'as-1', label: 'logo.png' },
      { kind: 'repo', id: 'acme/site', label: 'acme/site' },
    ])
  })

  test('floats selected elements and the linked repo to the top of their groups', () => {
    const catalog = composerMentionItems({
      elements: [
        { id: 'el-1', name: 'Hero', w: 320, h: 180 },
        { id: 'el-2', name: 'Footer', w: 320, h: 80 },
      ],
      assets: [],
      repos: [{ fullName: 'acme/other' }, { fullName: 'acme/site' }],
      selectedIds: ['el-2'],
      preferredRepo: 'acme/site',
    })
    expect(catalog.filter((item) => item.kind === 'element').map((item) => item.id)).toEqual([
      'el-2',
      'el-1',
    ])
    expect(catalog.find((item) => item.id === 'el-2')?.hint).toBe('Selected · 320×80')
    expect(catalog.filter((item) => item.kind === 'repo').map((item) => item.id)).toEqual([
      'acme/site',
      'acme/other',
    ])
    expect(catalog.find((item) => item.id === 'acme/site')?.hint).toBe('Linked')
  })
})
