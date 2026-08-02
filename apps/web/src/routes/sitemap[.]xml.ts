import { createFileRoute } from '@tanstack/react-router'
import { absoluteUrl } from '#/lib/seo'
import { sitemapEntries } from '#/lib/site-map'

/**
 * `/sitemap.xml`, generated from the same list `/llms.txt` reads, so a page set
 * cannot be added to one and forgotten in the other.
 *
 * Cached for an hour: the content only changes on deploy, and a crawler asking
 * more often than that should not be re-rendering the list each time.
 */
function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function renderSitemap() {
  const urls = sitemapEntries()
    .map((entry) =>
      [
        '  <url>',
        `    <loc>${escapeXml(absoluteUrl(entry.path))}</loc>`,
        `    <lastmod>${entry.lastmod}</lastmod>`,
        `    <changefreq>${entry.changefreq}</changefreq>`,
        `    <priority>${entry.priority.toFixed(1)}</priority>`,
        '  </url>',
      ].join('\n'),
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`
}

export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: () =>
        new Response(renderSitemap(), {
          status: 200,
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          },
        }),
    },
  },
})
