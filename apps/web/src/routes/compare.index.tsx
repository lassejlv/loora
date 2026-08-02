import { createFileRoute, Link } from '@tanstack/react-router'
import { COMPARISONS, COMPARISON_VERIFIED } from '#/components/landing/comparisons'
import {
  CardGrid,
  CardLink,
  Dek,
  LINK,
  PageTitle,
  Section,
  useAccent,
} from '#/components/landing/page-parts'
import { LandingShell } from '#/components/landing/site-shell'
import { breadcrumbSchema, itemListSchema, jsonLd, seo } from '#/lib/seo'

const TITLE = 'Loora compared — Figma, Framer, Penpot, v0, and Lovable'

const DESCRIPTION =
  'Honest comparisons between Loora and the tools people weigh it against, including where each of the others is the better answer.'

export const Route = createFileRoute('/compare/')({
  head: () => ({
    ...seo({ title: TITLE, description: DESCRIPTION, path: '/compare' }),
    scripts: [
      jsonLd([
        breadcrumbSchema([{ name: 'Compare', path: '/compare' }]),
        itemListSchema(
          COMPARISONS.map((comparison) => ({
            name: comparison.headline,
            path: `/compare/${comparison.slug}`,
          })),
        ),
      ]),
    ],
  }),
  component: CompareIndexPage,
})

function CompareIndexPage() {
  const accent = useAccent()

  return (
    <LandingShell>
      <PageTitle>How Loora compares.</PageTitle>
      <Dek>
        Loora is narrow on purpose: a structured design canvas an agent can write to over MCP, with
        branches, history, and one-way code export. Plenty of tools do more than that, and several
        do parts of it better. These pages say which.
      </Dek>

      <p className="mt-4 text-muted-foreground">
        Every page here names the cases where the other tool is the right choice, and it goes first.
        A comparison that cannot do that is not a comparison.
      </p>

      <Section title="Comparisons">
        <CardGrid count={COMPARISONS.length}>
          {COMPARISONS.map((comparison) => (
            <CardLink
              key={comparison.slug}
              href={`/compare/${comparison.slug}`}
              title={comparison.headline}
              summary={comparison.tagline}
            />
          ))}
        </CardGrid>
        <p className="mt-5 text-[12px] text-muted-foreground">
          Claims about other products were last checked on {COMPARISON_VERIFIED}. They move; check
          the vendor’s own documentation before deciding on the strength of a row in a table.
        </p>
      </Section>

      <Section title="The short version">
        <p className="mt-4 text-muted-foreground">
          If you want an agent to <em>build</em> the design rather than describe it — inserting real
          nodes, setting tokens, working on a branch you can throw away — that is the thing Loora
          does that the others do not. If you want an ecosystem, hosting, prototyping depth, a free
          self-hosted server, or a whole running application, one of the others is a better
          purchase, and the pages above say which one.
        </p>
        <p className="mt-4">
          <Link to="/features" className={LINK} style={accent}>
            What Loora actually does →
          </Link>
        </p>
      </Section>
    </LandingShell>
  )
}
