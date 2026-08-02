import { createFileRoute } from '@tanstack/react-router'
import { MCP_ENDPOINT } from '#/components/landing/mcp-clients'
import { absoluteUrl, SITE_URL } from '#/lib/seo'
import { sitemapEntries } from '#/lib/site-map'

/**
 * `/llms.txt` — the site, described for a model rather than for a crawler.
 *
 * Worth having here specifically: Loora's users arrive by asking an agent how
 * to connect a design tool, and the agent that answers has usually read the
 * markdown, not rendered the page. The MCP endpoint is stated first for that
 * reason — it is the one fact that makes the rest actionable.
 */
function renderLlmsTxt() {
  const grouped = {
    Product: [] as string[],
    'MCP setup': [] as string[],
    Learn: [] as string[],
    Comparisons: [] as string[],
    Legal: [] as string[],
  }

  for (const entry of sitemapEntries()) {
    const line = `- [${entry.title}](${absoluteUrl(entry.path)}): ${entry.summary}`
    if (entry.path.startsWith('/mcp')) grouped['MCP setup'].push(line)
    else if (entry.path.startsWith('/learn')) grouped.Learn.push(line)
    else if (entry.path.startsWith('/compare')) grouped.Comparisons.push(line)
    else if (entry.path === '/terms' || entry.path === '/privacy') grouped.Legal.push(line)
    else grouped.Product.push(line)
  }

  const sections = Object.entries(grouped)
    .filter(([, lines]) => lines.length > 0)
    .map(([heading, lines]) => `## ${heading}\n\n${lines.join('\n')}`)
    .join('\n\n')

  return `# Loora

> Loora is an infinite-canvas design tool with a remote MCP server built in. A
> coding agent connects over MCP and edits the same structured design document
> a person has open in the browser, through the same validated transactions.
> Designs have branches, version history, and one-way export to HTML/CSS,
> React/TSX, JSX, Tailwind, JSON, and PNG.

There is no in-app chat agent. You bring your own client.

## For agents

MCP endpoint: ${MCP_ENDPOINT}
Transport: streamable HTTP (remote). Auth: OAuth 2.1 with PKCE and dynamic
client registration — no API key.

33 tools, grouped: read (listDesigns, getDesignContext, readNode, readTree,
searchNodes, listAssets, listVersions), write (createPage, insertNodes,
patchNodes, moveNodes, deleteNodes), reuse (createComponent, createInstance,
setTokens), motion (setAnimations, animateNodes), look (viewCanvas, viewPage,
viewNode, getScreenshot), branches (listBranches, createBranch, proposeBranch,
compareBranch, applyBranch, reopenBranch, closeBranch), designs (createDesign,
renameDesign, deleteDesign, exportCode).

Recommended order when building: setTokens, then createComponent, then
insertNodes, then getScreenshot, then patchNodes. Define the palette and the
spacing scale before drawing anything — an agent that picks values per section
produces an incoherent page. Use createBranch for speculative work.

${sections}

## Notes

- Setup instructions differ per client mainly in one key name: url, serverUrl,
  httpUrl, and uri all mean the same thing to a different product. See the
  per-client pages under ${SITE_URL}/mcp.
- Export is one-way. Edited code never returns to the canvas document.
- MCP calls are metered weekly: 100/week on Free, 1,000,000/week on Pro.
`
}

export const Route = createFileRoute('/llms.txt')({
  server: {
    handlers: {
      GET: () =>
        new Response(renderLlmsTxt(), {
          status: 200,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          },
        }),
    },
  },
})
