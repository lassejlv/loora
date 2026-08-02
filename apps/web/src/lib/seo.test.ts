import { describe, expect, test } from 'vitest'
import { absoluteUrl, faqSchema, seo, SITE_URL } from '#/lib/seo'

const find = (meta: Record<string, string>[], key: 'name' | 'property', value: string) =>
  meta.find((tag) => tag[key] === value)?.content

describe('seo', () => {
  test('emits an absolute canonical and og:url for an indexable page', () => {
    const { meta, links } = seo({ title: 'T', description: 'D', path: '/mcp/cursor' })

    expect(links).toEqual([{ rel: 'canonical', href: `${SITE_URL}/mcp/cursor` }])
    expect(find(meta, 'property', 'og:url')).toBe(`${SITE_URL}/mcp/cursor`)
    expect(find(meta, 'name', 'robots')).toContain('index, follow')
  })

  test('resolves a relative social image against the site origin', () => {
    // Relative og:image is the single most commonly shipped SEO bug: browsers
    // resolve it, most unfurlers do not.
    const { meta } = seo({ title: 'T', description: 'D', path: '/' })

    expect(find(meta, 'property', 'og:image')).toBe(`${SITE_URL}/landing-cover.png`)
    expect(find(meta, 'name', 'twitter:image')).toBe(`${SITE_URL}/landing-cover.png`)
    expect(find(meta, 'name', 'twitter:card')).toBe('summary_large_image')
  })

  test('a noindex page carries no canonical', () => {
    // A canonical says "index this instead"; noindex says "index nothing".
    // Sending both is a contradiction crawlers resolve unpredictably.
    const { meta, links } = seo({
      title: 'T',
      description: 'D',
      path: '/app',
      noindex: true,
    })

    expect(links).toEqual([])
    expect(find(meta, 'name', 'robots')).toBe('noindex, nofollow')
    expect(find(meta, 'property', 'og:url')).toBeUndefined()
  })

  test('article pages carry their dates', () => {
    const { meta } = seo({
      title: 'T',
      description: 'D',
      path: '/learn/design-tokens',
      type: 'article',
      publishedTime: '2026-08-02',
      modifiedTime: '2026-08-03',
    })

    expect(find(meta, 'property', 'og:type')).toBe('article')
    expect(find(meta, 'property', 'article:published_time')).toBe('2026-08-02')
    expect(find(meta, 'property', 'article:modified_time')).toBe('2026-08-03')
  })

  test('absoluteUrl leaves an absolute URL alone and prefixes a bare path', () => {
    expect(absoluteUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png')
    expect(absoluteUrl('learn')).toBe(`${SITE_URL}/learn`)
  })

  test('faqSchema shapes questions the way schema.org expects', () => {
    const schema = faqSchema([{ question: 'Q?', answer: 'A.' }])

    expect(schema['@type']).toBe('FAQPage')
    expect(schema.mainEntity).toEqual([
      { '@type': 'Question', name: 'Q?', acceptedAnswer: { '@type': 'Answer', text: 'A.' } },
    ])
  })
})
