import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import {
  COMPARISONS,
  COMPARISON_VERIFIED,
  findComparison,
} from '#/components/landing/comparisons'
import {
  Breadcrumbs,
  Bullets,
  Dek,
  Faq,
  LINK,
  PageTitle,
  Related,
  Section,
  useAccent,
} from '#/components/landing/page-parts'
import { LandingShell } from '#/components/landing/site-shell'
import { Td, TableScroll, Th } from '#/components/landing/table'
import { breadcrumbSchema, faqSchema, jsonLd, seo } from '#/lib/seo'

export const Route = createFileRoute('/compare/$slug')({
  loader: ({ params }) => {
    if (!findComparison(params.slug)) throw notFound()
    return null
  },
  head: ({ params }) => {
    const comparison = findComparison(params.slug)
    if (!comparison)
      return seo({
        title: 'Not found — Loora',
        description: 'This page does not exist.',
        noindex: true,
      })

    const path = `/compare/${comparison.slug}`
    return {
      ...seo({
        title: `${comparison.headline} — Loora`,
        description: comparison.description,
        path,
        type: 'article',
        modifiedTime: COMPARISON_VERIFIED,
      }),
      scripts: [
        jsonLd([
          breadcrumbSchema([
            { name: 'Compare', path: '/compare' },
            { name: comparison.headline, path },
          ]),
          faqSchema(comparison.faq),
        ]),
      ],
    }
  },
  notFoundComponent: NotFound,
  component: ComparePage,
})

function NotFound() {
  const accent = useAccent()
  return (
    <LandingShell>
      <PageTitle>No comparison at that address.</PageTitle>
      <Dek>That page does not exist. The comparisons that do are listed below.</Dek>
      <p className="mt-6">
        <a href="/compare" className={LINK} style={accent}>
          All comparisons →
        </a>
      </p>
    </LandingShell>
  )
}

function ComparePage() {
  const { slug } = Route.useParams()
  const comparison = findComparison(slug)
  const accent = useAccent()

  if (!comparison) return <NotFound />

  const related = comparison.related
    .map((relatedSlug) => COMPARISONS.find((entry) => entry.slug === relatedSlug))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))

  return (
    <LandingShell>
      <Breadcrumbs
        trail={[
          { label: 'Compare', href: '/compare' },
          { label: comparison.headline, href: `/compare/${comparison.slug}` },
        ]}
      />

      <PageTitle>{comparison.headline}</PageTitle>
      <Dek>{comparison.summary}</Dek>

      <Section title="Side by side">
        <TableScroll label={`Loora compared with ${comparison.other}`}>
          <thead>
            <tr>
              <Th>&nbsp;</Th>
              <Th>Loora</Th>
              <Th>{comparison.other}</Th>
            </tr>
          </thead>
          <tbody>
            {comparison.table.map((row) => (
              <tr key={row.aspect}>
                <Td strong>{row.aspect}</Td>
                <Td muted>{row.loora}</Td>
                <Td muted>{row.other}</Td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      </Section>

      {/* Their column first. A comparison page that leads with its own strengths
          is an advert, and readers price it as one. */}
      <Section title={`Choose ${comparison.other} when`}>
        <Bullets items={comparison.otherWins} />
      </Section>

      <Section title="Choose Loora when">
        <Bullets items={comparison.looraWins} />
      </Section>

      <Section title="The honest summary">
        <p className="mt-4 text-muted-foreground">{comparison.verdict}</p>
        <p className="mt-4 text-[12px] text-muted-foreground">
          Claims about {comparison.other} were last checked on {COMPARISON_VERIFIED}. Products
          change; check their documentation before deciding on the strength of a table.
        </p>
      </Section>

      <Section title="Questions">
        <Faq entries={comparison.faq} />
      </Section>

      <Related
        title="Other comparisons"
        items={related.map((entry) => ({
          label: entry.headline,
          href: `/compare/${entry.slug}`,
        }))}
      />

      <p className="mt-10">
        <Link to="/features" className={LINK} style={accent}>
          What Loora actually does →
        </Link>
      </p>
      <p className="mt-4">
        <a href="/mcp" className={LINK} style={accent}>
          Connect your agent over MCP →
        </a>
      </p>
    </LandingShell>
  )
}
