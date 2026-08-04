import { COMPARISONS, COMPARISON_VERIFIED } from '#/components/landing/comparisons'
import { LEARN_ARTICLES, LEARN_UPDATED } from '#/components/landing/learn'
import { MCP_CLIENTS } from '#/components/landing/mcp-clients'

/**
 * Every indexable URL on the site, in one list.
 *
 * `/sitemap.xml` and `/llms.txt` are both generated from this, so a new page
 * set cannot end up in one and not the other. Anything gated, ephemeral, or
 * signed-in belongs nowhere near it.
 */

/** Bumped when the hand-written marketing pages change materially. */
export const SITE_UPDATED = '2026-08-02'

export type SitemapEntry = {
  path: string
  /** Relative weight within this site only — it says nothing to a crawler about other sites. */
  priority: number
  changefreq: 'daily' | 'weekly' | 'monthly' | 'yearly'
  lastmod: string
  /** Used by `/llms.txt`; not part of the XML. */
  title: string
  summary: string
}

const STATIC_PAGES: SitemapEntry[] = [
  {
    path: '/',
    priority: 1,
    changefreq: 'weekly',
    lastmod: SITE_UPDATED,
    title: 'Loora — design files your agent can edit',
    summary:
      'Canvas design tool with a built-in MCP server. Your agent edits the same structured document you have open.',
  },
  {
    path: '/features',
    priority: 0.9,
    changefreq: 'monthly',
    lastmod: SITE_UPDATED,
    title: 'Features',
    summary:
      'The canvas document, typed transactions, MCP, branches, history, exports, and HTML/CSS import.',
  },
  {
    path: '/mcp',
    priority: 0.9,
    changefreq: 'weekly',
    lastmod: SITE_UPDATED,
    title: 'MCP setup',
    summary:
      'The remote MCP endpoint, the tool vocabulary, and setup guides for every supported client.',
  },
  {
    path: '/pricing',
    priority: 0.8,
    changefreq: 'monthly',
    lastmod: SITE_UPDATED,
    title: 'Pricing',
    summary: 'Free at $0/month, Pro at $20/month. Limits on files, assets, Agent Calls, and history.',
  },
  {
    path: '/learn',
    priority: 0.7,
    changefreq: 'monthly',
    lastmod: LEARN_UPDATED,
    title: 'Learn',
    summary: 'Explainers on MCP, structured design documents, tokens, branching, and code export.',
  },
  {
    path: '/compare',
    priority: 0.7,
    changefreq: 'monthly',
    lastmod: COMPARISON_VERIFIED,
    title: 'Comparisons',
    summary: 'How Loora differs from Figma, Framer, Penpot, v0, and Lovable — including where they win.',
  },
  {
    path: '/launch-week',
    priority: 0.4,
    changefreq: 'daily',
    lastmod: SITE_UPDATED,
    title: 'Launch week',
    summary:
      'One new Loora release a day — the schedule, what shipped, and what is still to come.',
  },
  {
    path: '/terms',
    priority: 0.2,
    changefreq: 'yearly',
    lastmod: SITE_UPDATED,
    title: 'Terms of Service',
    summary: 'The terms governing access to and use of Loora.',
  },
  {
    path: '/privacy',
    priority: 0.2,
    changefreq: 'yearly',
    lastmod: SITE_UPDATED,
    title: 'Privacy Policy',
    summary: 'What Loora collects, why, and what is done with it.',
  },
]

export function sitemapEntries(): SitemapEntry[] {
  return [
    ...STATIC_PAGES,
    ...MCP_CLIENTS.map((client) => ({
      path: `/mcp/${client.slug}`,
      priority: 0.8,
      changefreq: 'monthly' as const,
      lastmod: SITE_UPDATED,
      title: `${client.name} — MCP setup`,
      summary: client.description,
    })),
    ...LEARN_ARTICLES.map((article) => ({
      path: `/learn/${article.slug}`,
      priority: 0.6,
      changefreq: 'monthly' as const,
      lastmod: LEARN_UPDATED,
      title: article.headline,
      summary: article.description,
    })),
    ...COMPARISONS.map((comparison) => ({
      path: `/compare/${comparison.slug}`,
      priority: 0.6,
      changefreq: 'monthly' as const,
      lastmod: COMPARISON_VERIFIED,
      title: comparison.headline,
      summary: comparison.description,
    })),
  ]
}
