import { describe, expect, test } from 'vitest'
import { COMPARISONS } from '#/components/landing/comparisons'
import { LEARN_ARTICLES } from '#/components/landing/learn'
import { MCP_CLIENTS } from '#/components/landing/mcp-clients'
import { sitemapEntries } from '#/lib/site-map'

/**
 * The failure mode of a generated page set is a link to a slug that does not
 * exist — a 404 a crawler finds before anybody else does. These check the
 * cross-references rather than the prose.
 */
describe('generated page sets', () => {
  test('every related slug resolves', () => {
    const mcp = new Set(MCP_CLIENTS.map((client) => client.slug))
    const learn = new Set(LEARN_ARTICLES.map((article) => article.slug))
    const compare = new Set(COMPARISONS.map((comparison) => comparison.slug))

    for (const client of MCP_CLIENTS)
      for (const slug of client.related)
        expect(mcp, `${client.slug} → ${slug}`).toContain(slug)

    for (const article of LEARN_ARTICLES)
      for (const slug of article.related)
        expect(learn, `${article.slug} → ${slug}`).toContain(slug)

    for (const comparison of COMPARISONS)
      for (const slug of comparison.related)
        expect(compare, `${comparison.slug} → ${slug}`).toContain(slug)
  })

  test('no page links only to itself', () => {
    for (const client of MCP_CLIENTS) expect(client.related).not.toContain(client.slug)
    for (const article of LEARN_ARTICLES) expect(article.related).not.toContain(article.slug)
    for (const comparison of COMPARISONS) expect(comparison.related).not.toContain(comparison.slug)
  })

  test('slugs are url-safe and unique', () => {
    const all = [
      ...MCP_CLIENTS.map((client) => client.slug),
      ...LEARN_ARTICLES.map((article) => article.slug),
      ...COMPARISONS.map((comparison) => comparison.slug),
    ]
    for (const slug of all) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    // Slugs live under different prefixes, so only collisions within a set matter.
    expect(new Set(MCP_CLIENTS.map((c) => c.slug)).size).toBe(MCP_CLIENTS.length)
    expect(new Set(LEARN_ARTICLES.map((a) => a.slug)).size).toBe(LEARN_ARTICLES.length)
    expect(new Set(COMPARISONS.map((c) => c.slug)).size).toBe(COMPARISONS.length)
  })

  test('titles and descriptions are unique and sized for a search result', () => {
    const entries = sitemapEntries()
    const descriptions = entries.map((entry) => entry.summary)

    // Duplicate titles across a generated set are the classic thin-content tell.
    expect(new Set(entries.map((entry) => entry.title)).size).toBe(entries.length)
    expect(new Set(descriptions).size).toBe(descriptions.length)
    for (const entry of entries) {
      expect(entry.summary.length, entry.path).toBeGreaterThan(40)
      expect(entry.summary.length, entry.path).toBeLessThan(320)
    }
  })
})

describe('sitemapEntries', () => {
  test('covers every generated page exactly once', () => {
    const paths = sitemapEntries().map((entry) => entry.path)

    expect(new Set(paths).size).toBe(paths.length)
    for (const client of MCP_CLIENTS) expect(paths).toContain(`/mcp/${client.slug}`)
    for (const article of LEARN_ARTICLES) expect(paths).toContain(`/learn/${article.slug}`)
    for (const comparison of COMPARISONS) expect(paths).toContain(`/compare/${comparison.slug}`)
    for (const hub of ['/', '/features', '/mcp', '/pricing', '/learn', '/compare'])
      expect(paths).toContain(hub)
  })

  test('lists no signed-in or API surface', () => {
    for (const entry of sitemapEntries()) {
      expect(entry.path.startsWith('/app')).toBe(false)
      expect(entry.path.startsWith('/design')).toBe(false)
      expect(entry.path.startsWith('/api')).toBe(false)
      expect(entry.path.startsWith('/')).toBe(true)
    }
  })

  test('lastmod is a plain ISO date, as the sitemap schema requires', () => {
    for (const entry of sitemapEntries()) expect(entry.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
