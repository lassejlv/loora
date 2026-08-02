/**
 * One place that builds the head of every public page.
 *
 * Crawlers and unfurlers are stricter than browsers: `og:image` has to be an
 * absolute URL, a canonical has to be absolute, and a page with no `og:type`
 * or `twitter:card` renders as a bare link rather than a card. Building the
 * tags here rather than per route keeps that from drifting page to page.
 */

/**
 * The origin the site is canonically served from. Everything indexable points
 * at this host, so a preview deployment never advertises itself as the real
 * one. `VITE_SITE_URL` overrides it for other environments.
 */
export const SITE_URL = (
  (import.meta.env.VITE_SITE_URL as string | undefined) || 'https://loora.design'
).replace(/\/+$/, '')

export const SITE_NAME = 'Loora'

/** Fallback social card, used by every page that has nothing better. */
const DEFAULT_IMAGE = '/landing-cover.png'

/** `/mcp/cursor` → `https://loora.design/mcp/cursor`; absolute input passes through. */
export function absoluteUrl(path: string) {
  if (/^https?:\/\//.test(path)) return path
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

type MetaTag = Record<string, string>

export type SeoOptions = {
  /** Full `<title>`, written out — no template is applied on top of it. */
  title: string
  description: string
  /** Canonical path on this site, e.g. `/mcp/cursor`. Omit for non-indexable pages. */
  path?: string
  /** Social card; relative paths are resolved against `SITE_URL`. */
  image?: string
  type?: 'website' | 'article'
  /** Keep the page out of the index — app surfaces, consent screens, callbacks. */
  noindex?: boolean
  /** ISO dates for article-type pages. */
  publishedTime?: string
  modifiedTime?: string
}

/**
 * Returns the `meta` and `links` a route's `head()` should carry. Spread it:
 * `head: () => ({ ...seo({ ... }) })`.
 */
export function seo(options: SeoOptions): { meta: MetaTag[]; links: { rel: string; href: string }[] } {
  const { title, description, path, type = 'website', noindex } = options
  const image = absoluteUrl(options.image ?? DEFAULT_IMAGE)
  const url = path ? absoluteUrl(path) : undefined

  const meta: MetaTag[] = [
    { title },
    { name: 'description', content: description },

    { property: 'og:type', content: type },
    { property: 'og:site_name', content: SITE_NAME },
    { property: 'og:locale', content: 'en_US' },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:image', content: image },
    { property: 'og:image:alt', content: title },

    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: image },
  ]

  // A noindex page has no canonical address to advertise, so it gets neither a
  // canonical link nor an `og:url` — the two would otherwise disagree.
  if (url && !noindex) meta.push({ property: 'og:url', content: url })
  if (options.publishedTime)
    meta.push({ property: 'article:published_time', content: options.publishedTime })
  if (options.modifiedTime)
    meta.push({ property: 'article:modified_time', content: options.modifiedTime })

  // `noindex` and a canonical are contradictory instructions; send one or the
  // other. Also tell Google not to shorten the snippet or the preview image,
  // which is what these otherwise-obscure directives buy on a card-heavy page.
  if (noindex) {
    meta.push({ name: 'robots', content: 'noindex, nofollow' })
  } else {
    meta.push({
      name: 'robots',
      content: 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
    })
  }

  return { meta, links: url && !noindex ? [{ rel: 'canonical', href: url }] : [] }
}

/** A `<script type="application/ld+json">` entry for a route's `head().scripts`. */
export function jsonLd(data: Record<string, unknown> | Record<string, unknown>[]) {
  return { type: 'application/ld+json', children: JSON.stringify(data) }
}

/**
 * The product itself. Sits on the landing page and on `/pricing`, where the
 * offers make it eligible for a price-carrying result.
 */
export function softwareApplicationSchema(options?: { withOffers?: boolean }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    url: SITE_URL,
    applicationCategory: 'DesignApplication',
    applicationSubCategory: 'Interface design',
    operatingSystem: 'Web, macOS, Windows, Linux',
    description:
      'A canvas design tool with a built-in MCP server, so a coding agent can read and edit the same structured design file you have open.',
    image: absoluteUrl(DEFAULT_IMAGE),
    softwareHelp: { '@type': 'CreativeWork', url: `${SITE_URL}/mcp` },
    featureList: [
      'Structured canvas document',
      'Remote MCP server for Claude, Codex, Cursor, and opencode',
      'Branches with semantic merge',
      'Version history',
      'HTML, React/TSX, Tailwind, JSON, and PNG export',
      'HTML/CSS import',
    ],
    ...(options?.withOffers
      ? {
          offers: [
            {
              '@type': 'Offer',
              name: 'Free',
              price: '0',
              priceCurrency: 'USD',
              url: `${SITE_URL}/pricing`,
              category: 'free',
            },
            {
              '@type': 'Offer',
              name: 'Pro',
              price: '20',
              priceCurrency: 'USD',
              url: `${SITE_URL}/pricing`,
              category: 'subscription',
            },
          ],
        }
      : {}),
  }
}

/** Publisher identity, so the two names resolve to one entity. */
export function organizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: absoluteUrl('/logo512.png'),
    sameAs: ['https://github.com/lassejlv/loora'],
  }
}

/** Site-wide search box on the brand result. */
export function webSiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
  }
}

/**
 * `[{ name: 'MCP', path: '/mcp' }, { name: 'Cursor', path: '/mcp/cursor' }]`
 * — the home crumb is added here so no caller has to remember it.
 */
export function breadcrumbSchema(trail: { name: string; path: string }[]) {
  const items = [{ name: 'Loora', path: '/' }, ...trail]
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  }
}

export function faqSchema(entries: readonly { question: string; answer: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer },
    })),
  }
}

/** Setup instructions, for the pages that are literally a set of steps. */
export function howToSchema(options: {
  name: string
  description: string
  path: string
  steps: readonly string[]
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: options.name,
    description: options.description,
    url: absoluteUrl(options.path),
    step: options.steps.map((step, index) => ({
      '@type': 'HowToStep',
      position: index + 1,
      text: step,
    })),
  }
}

export function articleSchema(options: {
  headline: string
  description: string
  path: string
  datePublished: string
  dateModified?: string
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: options.headline,
    description: options.description,
    url: absoluteUrl(options.path),
    image: absoluteUrl(DEFAULT_IMAGE),
    datePublished: options.datePublished,
    dateModified: options.dateModified ?? options.datePublished,
    author: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL,
      logo: { '@type': 'ImageObject', url: absoluteUrl('/logo512.png') },
    },
  }
}

/** A list page (`/mcp`, `/compare`, `/learn`) declaring what it links to. */
export function itemListSchema(items: readonly { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      url: absoluteUrl(item.path),
    })),
  }
}
